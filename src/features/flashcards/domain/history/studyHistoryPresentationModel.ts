import type { Language, StudyHistoryEntry } from "../../../../core/shared/types";
import { type TranslationKey } from "../../strings/index";
import { formatCompactDuration } from "../../strings/index";
import { formatLocalDateKey } from "./studyHistory";

export type StudyHistoryTranslator = (
	key: TranslationKey,
	vars?: Record<string, string | number>,
) => string;

export interface StudyHistoryModePresentation {
	labelKey:
		| "stats.modeStudy"
		| "stats.modePractice"
		| "stats.modeSpelling"
		| "challenge.title"
		| "stats.modeList";
	cls: string;
}

export interface StudyHistoryDayGroup {
	date: string;
	displayDate: string;
	entries: StudyHistoryEntry[];
	totalDuration: number;
	totalDurationLabel: string;
	totalCards: number;
}

export interface StudyHistoryTotalsPresentation {
	duration: number;
	durationLabel: string;
	cards: number;
}

export interface StudyHistoryPresentationModel {
	dayGroups: StudyHistoryDayGroup[];
	totals: StudyHistoryTotalsPresentation;
}

export interface BuildStudyHistoryPresentationModelOptions {
	language: Language;
	t: StudyHistoryTranslator;
	now?: Date;
}

export const STUDY_HISTORY_MODE_PRESENTATION: Record<
	StudyHistoryEntry["mode"],
	StudyHistoryModePresentation
> = {
	study: { labelKey: "stats.modeStudy", cls: "stats-mode-study" },
	practice: { labelKey: "stats.modePractice", cls: "stats-mode-practice" },
	spelling: { labelKey: "stats.modeSpelling", cls: "stats-mode-spelling" },
	challenge: { labelKey: "challenge.title", cls: "stats-mode-challenge" },
	"word-list": { labelKey: "stats.modeList", cls: "stats-mode-list" },
};

export function buildStudyHistoryPresentationModel(
	history: StudyHistoryEntry[],
	{ language, t, now = new Date() }: BuildStudyHistoryPresentationModelOptions,
): StudyHistoryPresentationModel {
	const dayGroups = buildStudyHistoryDayGroups(history, { language, t, now });
	const totals = history.reduce(
		(accumulator, entry) => ({
			duration: accumulator.duration + entry.duration,
			cards: accumulator.cards + entry.cardCount,
		}),
		{ duration: 0, cards: 0 },
	);

	return {
		dayGroups,
		totals: {
			...totals,
			durationLabel: formatCompactDuration(language, totals.duration),
		},
	};
}

function buildStudyHistoryDayGroups(
	history: StudyHistoryEntry[],
	options: BuildStudyHistoryPresentationModelOptions & { now: Date },
): StudyHistoryDayGroup[] {
	const map = new Map<string, StudyHistoryEntry[]>();
	for (const entry of history) {
		const entries = map.get(entry.date) ?? [];
		entries.push(entry);
		map.set(entry.date, entries);
	}

	return Array.from(map.entries())
		.sort(([a], [b]) => b.localeCompare(a))
		.map(([date, entries]) => {
			const sortedEntries = [...entries].sort((a, b) => a.timestamp - b.timestamp);
			const totalDuration = entries.reduce((sum, entry) => sum + entry.duration, 0);
			const totalCards = entries.reduce((sum, entry) => sum + entry.cardCount, 0);

			return {
				date,
				displayDate: formatStudyHistoryDate(date, options),
				entries: sortedEntries,
				totalDuration,
				totalDurationLabel: formatCompactDuration(options.language, totalDuration),
				totalCards,
			};
		});
}

const WEEKDAY_FORMATTERS: Record<string, Intl.DateTimeFormat> = {
	zh: new Intl.DateTimeFormat("zh-CN", { weekday: "short" }),
	en: new Intl.DateTimeFormat("en-US", { weekday: "short" }),
};

function getWeekdayFormatter(language: Language): Intl.DateTimeFormat {
	let formatter = WEEKDAY_FORMATTERS[language];
	if (!formatter) {
		formatter = new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
			weekday: "short",
		});
		WEEKDAY_FORMATTERS[language] = formatter;
	}
	return formatter;
}

function formatStudyHistoryDate(
	dateStr: string,
	{ language, t, now }: BuildStudyHistoryPresentationModelOptions & { now: Date },
): string {
	const todayStr = formatLocalDateKey(now);
	const yesterday = new Date(now.getTime() - 86400000);
	const yesterdayStr = formatLocalDateKey(yesterday);

	const parts = dateStr.split("-");
	const month = parts[1] ?? "";
	const day = parts[2] ?? "";
	const display = t("stats.monthDay", { month, day });

	if (dateStr === todayStr) {
		return t("stats.dateWithLabel", {
			date: display,
			label: t("stats.today"),
		});
	}
	if (dateStr === yesterdayStr) {
		return t("stats.dateWithLabel", {
			date: display,
			label: t("stats.yesterday"),
		});
	}

	const date = new Date(`${dateStr}T00:00:00`);
	const weekday = getWeekdayFormatter(language).format(date);
	return t("stats.dateWithLabel", { date: display, label: weekday });
}
