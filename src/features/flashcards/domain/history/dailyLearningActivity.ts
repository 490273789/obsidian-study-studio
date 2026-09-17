import { formatLocalDateKey } from "./studyHistory";

export type LearningActivityMode = "study" | "practice" | "spelling";
export type TimedLearningActivityMode = LearningActivityMode | "word-list";

export interface DailyLearningActivity {
	readonly date: string;
	readonly answers: Readonly<Record<LearningActivityMode, number>>;
	readonly seconds: Readonly<Record<TimedLearningActivityMode, number>>;
	readonly completedAnswers: Readonly<Record<LearningActivityMode, number>>;
	readonly completedSessions: Readonly<Record<LearningActivityMode, number>>;
}

export interface LearningActivityDelta {
	readonly mode: TimedLearningActivityMode;
	readonly answerCount: number;
	readonly duration: number;
	readonly completed: boolean;
}

export interface LearningFootprintDay {
	readonly date: string;
	readonly future: boolean;
	readonly level: 0 | 1 | 2 | 3 | 4;
	readonly completedAnswerCount: number;
	readonly hasActivity: boolean;
	readonly activity: DailyLearningActivity;
}

export interface LearningFootprintWeek {
	readonly days: readonly LearningFootprintDay[];
}

export interface LearningFootprintSnapshot {
	readonly today: DailyLearningActivity;
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

export function createEmptyDailyLearningActivity(date: string): DailyLearningActivity {
	return {
		date,
		answers: { study: 0, practice: 0, spelling: 0 },
		seconds: { study: 0, practice: 0, spelling: 0, "word-list": 0 },
		completedAnswers: { study: 0, practice: 0, spelling: 0 },
		completedSessions: { study: 0, practice: 0, spelling: 0 },
	};
}

export function appendLearningActivity(
	activities: readonly DailyLearningActivity[],
	deltas: readonly LearningActivityDelta[],
	now: Date = new Date(),
): DailyLearningActivity[] {
	if (deltas.length === 0) return activities.map(cloneDailyLearningActivity);
	const date = formatLocalDateKey(now);
	const map = new Map(
		activities.map((activity) => [activity.date, cloneDailyLearningActivity(activity)]),
	);
	let current = map.get(date) ?? createEmptyDailyLearningActivity(date);

	for (const delta of deltas) {
		const answerCount = normalizeCount(delta.answerCount);
		const duration = normalizeCount(delta.duration);
		const answers = { ...current.answers };
		const seconds = { ...current.seconds };
		const completedAnswers = { ...current.completedAnswers };
		const completedSessions = { ...current.completedSessions };

		seconds[delta.mode] += duration;
		if (delta.mode !== "word-list") {
			answers[delta.mode] += answerCount;
			if (delta.completed) {
				completedAnswers[delta.mode] += answerCount;
				completedSessions[delta.mode] += 1;
			}
		}
		current = { date, answers, seconds, completedAnswers, completedSessions };
	}

	map.set(date, current);
	return Array.from(map.values()).sort((left, right) => left.date.localeCompare(right.date));
}

export function normalizeDailyLearningActivities(value: unknown): DailyLearningActivity[] {
	if (!Array.isArray(value)) return [];
	const normalized = new Map<string, DailyLearningActivity>();
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
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
		const candidate = item as Partial<DailyLearningActivity>;
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

export function buildLearningFootprint(
	activities: readonly DailyLearningActivity[],
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
	byDate: ReadonlyMap<string, DailyLearningActivity>,
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

function calculateBestStreak(activities: readonly DailyLearningActivity[]): number {
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

function isCompletionDay(activity: DailyLearningActivity | undefined): boolean {
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

function cloneDailyLearningActivity(activity: DailyLearningActivity): DailyLearningActivity {
	return {
		date: activity.date,
		answers: { ...activity.answers },
		seconds: { ...activity.seconds },
		completedAnswers: { ...activity.completedAnswers },
		completedSessions: { ...activity.completedSessions },
	};
}
