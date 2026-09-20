import { formatLocalDateKey } from "./studyHistory";

export type LearningActivityMode = "study" | "practice" | "spelling";
export type TimedLearningActivityMode = LearningActivityMode | "word-list";

export interface DailyLearningActivityDay {
	readonly date: string;
	readonly answers: Readonly<Record<LearningActivityMode, number>>;
	readonly seconds: Readonly<Record<TimedLearningActivityMode, number>>;
	readonly completedAnswers: Readonly<Record<LearningActivityMode, number>>;
	readonly completedSessions: Readonly<Record<LearningActivityMode, number>>;
}

export type LearningActivityRecord =
	| {
			readonly kind: "session";
			readonly mode: LearningActivityMode;
			readonly completion: "completed" | "partial";
			readonly answerCount: number;
			readonly durationSeconds: number;
			readonly occurredAt: number;
	  }
	| {
			readonly kind: "word-list";
			readonly durationSeconds: number;
			readonly occurredAt: number;
	  };

export interface DailyLearningActivity {
	/** Returns an immutable candidate; the current value remains unchanged. */
	record(entry: LearningActivityRecord): DailyLearningActivity;
	/** Builds today's totals, Completion day streaks, and the 53-week footprint. */
	footprint(now: Date): LearningFootprintSnapshot;
	/** Returns a detached, persistence-compatible document sorted by local date. */
	toDocument(): DailyLearningActivityDay[];
}

export interface LearningFootprintDay {
	readonly date: string;
	readonly future: boolean;
	readonly level: 0 | 1 | 2 | 3 | 4;
	readonly completedAnswerCount: number;
	readonly hasActivity: boolean;
	readonly activity: DailyLearningActivityDay;
}

export interface LearningFootprintWeek {
	readonly days: readonly LearningFootprintDay[];
}

export interface LearningFootprintSnapshot {
	readonly today: DailyLearningActivityDay;
	readonly todayTotalSeconds: number;
	readonly currentStreak: number;
	readonly bestStreak: number;
	readonly weeks: readonly LearningFootprintWeek[];
}

const SESSION_MODES: readonly LearningActivityMode[] = ["study", "practice", "spelling"];
const TIMED_MODES: readonly TimedLearningActivityMode[] = [
	"study",
	"practice",
	"spelling",
	"word-list",
];
const HEATMAP_WEEK_COUNT = 53;

function createEmptyDailyLearningActivity(date: string): DailyLearningActivityDay {
	return {
		date,
		answers: { study: 0, practice: 0, spelling: 0 },
		seconds: { study: 0, practice: 0, spelling: 0, "word-list": 0 },
		completedAnswers: { study: 0, practice: 0, spelling: 0 },
		completedSessions: { study: 0, practice: 0, spelling: 0 },
	};
}

function recordLearningActivity(
	activities: readonly DailyLearningActivityDay[],
	entry: LearningActivityRecord,
): DailyLearningActivityDay[] {
	const date = formatLocalDateKey(new Date(entry.occurredAt));
	if (!isValidLocalDateKey(date)) throw new RangeError("Learning activity date is out of range");
	const map = new Map(
		activities.map((activity) => [activity.date, cloneDailyLearningActivity(activity)]),
	);
	let current = map.get(date) ?? createEmptyDailyLearningActivity(date);
	const duration = normalizeCount(entry.durationSeconds);
	const seconds = { ...current.seconds };
	if (entry.kind === "word-list") {
		seconds["word-list"] += duration;
		current = { ...current, seconds };
	} else {
		const answerCount = normalizeCount(entry.answerCount);
		const answers = { ...current.answers };
		const completedAnswers = { ...current.completedAnswers };
		const completedSessions = { ...current.completedSessions };
		seconds[entry.mode] += duration;
		answers[entry.mode] += answerCount;
		if (entry.completion === "completed") {
			completedAnswers[entry.mode] += answerCount;
			completedSessions[entry.mode] += 1;
		}
		current = { date, answers, seconds, completedAnswers, completedSessions };
	}

	map.set(date, current);
	return Array.from(map.values()).sort((left, right) => left.date.localeCompare(right.date));
}

function normalizeDailyLearningActivities(value: unknown): DailyLearningActivityDay[] {
	if (!Array.isArray(value)) return [];
	const normalized = new Map<string, DailyLearningActivityDay>();
	for (const item of value) {
		if (
			!item ||
			typeof item !== "object" ||
			!("date" in item) ||
			typeof item.date !== "string"
		) {
			continue;
		}
		const date = item.date;
		if (!isValidLocalDateKey(date)) continue;
		const candidate = item as Partial<DailyLearningActivityDay>;
		normalized.set(date, {
			date,
			answers: normalizeModeRecord(candidate.answers, SESSION_MODES),
			seconds: normalizeModeRecord(candidate.seconds, TIMED_MODES),
			completedAnswers: normalizeModeRecord(candidate.completedAnswers, SESSION_MODES),
			completedSessions: normalizeModeRecord(candidate.completedSessions, SESSION_MODES),
		});
	}
	return Array.from(normalized.values()).sort((left, right) =>
		left.date.localeCompare(right.date),
	);
}

function buildLearningFootprint(
	activities: readonly DailyLearningActivityDay[],
	now: Date = new Date(),
): LearningFootprintSnapshot {
	const normalized = normalizeDailyLearningActivities(activities);
	const byDate = new Map(normalized.map((activity) => [activity.date, activity]));
	const todayKey = formatLocalDateKey(now);
	const today = byDate.get(todayKey) ?? createEmptyDailyLearningActivity(todayKey);
	const currentStreak = calculateCurrentStreak(byDate, now);
	const bestStreak = calculateBestStreak(normalized);
	const start = startOfHeatmap(now);
	const days = Array.from({ length: HEATMAP_WEEK_COUNT * 7 }, (_, index) => {
		const date = addLocalDays(start, index);
		const dateKey = formatLocalDateKey(date);
		const activity = byDate.get(dateKey) ?? createEmptyDailyLearningActivity(dateKey);
		const completedAnswerCount = sumModes(activity.completedAnswers);
		return {
			date: dateKey,
			future: dateKey > todayKey,
			completedAnswerCount,
			hasActivity: sumModes(activity.answers) + sumModes(activity.seconds) > 0,
			activity,
		};
	});
	const positiveValues = days
		.filter((day) => !day.future && day.completedAnswerCount > 0)
		.map((day) => day.completedAnswerCount)
		.sort((left, right) => left - right);
	const thresholds = [0.25, 0.5, 0.75].map((quantile) => percentile(positiveValues, quantile));
	const weeks = Array.from({ length: HEATMAP_WEEK_COUNT }, (_, weekIndex) => ({
		days: days.slice(weekIndex * 7, weekIndex * 7 + 7).map((day) => ({
			...day,
			level: day.future ? 0 : getHeatLevel(day.completedAnswerCount, thresholds),
		})),
	}));

	return {
		today,
		todayTotalSeconds: sumModes(today.seconds),
		currentStreak,
		bestStreak,
		weeks,
	};
}

function calculateCurrentStreak(
	byDate: ReadonlyMap<string, DailyLearningActivityDay>,
	now: Date,
): number {
	let cursor = startOfLocalDay(now);
	if (!isCompletionDay(byDate.get(formatLocalDateKey(cursor)))) {
		cursor = addLocalDays(cursor, -1);
	}
	let streak = 0;
	while (isCompletionDay(byDate.get(formatLocalDateKey(cursor)))) {
		streak++;
		cursor = addLocalDays(cursor, -1);
	}
	return streak;
}

function calculateBestStreak(activities: readonly DailyLearningActivityDay[]): number {
	const completionDates = activities.filter(isCompletionDay).map((activity) => activity.date);
	let best = 0;
	let current = 0;
	let previous: Date | null = null;
	for (const dateKey of completionDates) {
		const date = parseLocalDateKey(dateKey);
		current =
			previous && formatLocalDateKey(addLocalDays(previous, 1)) === dateKey ? current + 1 : 1;
		best = Math.max(best, current);
		previous = date;
	}
	return best;
}

function isCompletionDay(activity: DailyLearningActivityDay | undefined): boolean {
	return Boolean(activity && sumModes(activity.completedSessions) > 0);
}

function startOfHeatmap(now: Date): Date {
	const today = startOfLocalDay(now);
	const mondayOffset = (today.getDay() + 6) % 7;
	return addLocalDays(today, -mondayOffset - (HEATMAP_WEEK_COUNT - 1) * 7);
}

function startOfLocalDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, days: number): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function parseLocalDateKey(value: string): Date {
	const [year, month, day] = value.split("-").map(Number);
	return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

function isValidLocalDateKey(value: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (year < 1 || month < 1 || month > 12 || day < 1) return false;
	const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	return day <= (daysInMonth[month - 1] ?? 0);
}

function isLeapYear(year: number): boolean {
	return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function percentile(values: readonly number[], quantile: number): number {
	if (values.length === 0) return 0;
	return values[Math.min(values.length - 1, Math.ceil(values.length * quantile) - 1)] ?? 0;
}

function getHeatLevel(value: number, thresholds: readonly number[]): 0 | 1 | 2 | 3 | 4 {
	if (value <= 0) return 0;
	if (value <= (thresholds[0] ?? 0)) return 1;
	if (value <= (thresholds[1] ?? 0)) return 2;
	if (value <= (thresholds[2] ?? 0)) return 3;
	return 4;
}

function normalizeModeRecord<K extends string>(
	value: unknown,
	keys: readonly K[],
): Record<K, number> {
	const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	return Object.fromEntries(keys.map((key) => [key, normalizeCount(source[key])])) as Record<
		K,
		number
	>;
}

function normalizeCount(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function sumModes(record: Readonly<Record<string, number>>): number {
	return Object.values(record).reduce((sum, value) => sum + value, 0);
}

function cloneDailyLearningActivity(activity: DailyLearningActivityDay): DailyLearningActivityDay {
	return {
		date: activity.date,
		answers: { ...activity.answers },
		seconds: { ...activity.seconds },
		completedAnswers: { ...activity.completedAnswers },
		completedSessions: { ...activity.completedSessions },
	};
}

export function restoreDailyLearningActivity(value: unknown): DailyLearningActivity {
	return new ImmutableDailyLearningActivity(normalizeDailyLearningActivities(value));
}

class ImmutableDailyLearningActivity implements DailyLearningActivity {
	constructor(private readonly days: readonly DailyLearningActivityDay[]) {}

	record(entry: LearningActivityRecord): DailyLearningActivity {
		assertValidTimestamp(entry.occurredAt);
		return new ImmutableDailyLearningActivity(recordLearningActivity(this.days, entry));
	}

	footprint(now: Date): LearningFootprintSnapshot {
		if (!Number.isFinite(now.getTime())) throw new RangeError("Invalid footprint date");
		return buildLearningFootprint(this.days, now);
	}

	toDocument(): DailyLearningActivityDay[] {
		return this.days.map(cloneDailyLearningActivity);
	}
}

function assertValidTimestamp(value: number): void {
	if (!Number.isFinite(value)) throw new RangeError("Invalid learning activity timestamp");
}
