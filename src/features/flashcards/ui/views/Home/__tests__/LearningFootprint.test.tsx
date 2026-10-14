import React from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type {
	LearningFootprintDay,
	LearningFootprintSnapshot,
} from "../../../../domain/history/dailyLearningActivity";
import { createTranslator } from "../../../../strings";
import { LearningFootprint, calculateHeatmapMonthLabels } from "../LearningFootprint";

const locale = vi.hoisted(() => ({ language: "en" as "zh" | "en" }));

// Inspect the real component's emitted accessibility props without a DOM reconciler.
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useEffect: () => {},
	useId: () => "footprint-title",
	useMemo: (factory: () => unknown) => factory(),
	useRef: (current: unknown) => ({ current }),
	useState: (initial: unknown) => [initial, () => {}],
}));
vi.mock("../../../../strings/context", async () => {
	const { createTranslator } = await import("../../../../strings");
	return {
		useFlashcardI18n: () => ({
			language: locale.language,
			t: createTranslator(locale.language),
		}),
	};
});

const NativeDate = Date;
const NativeDateTimeFormat = Intl.DateTimeFormat;

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function day(date: string): LearningFootprintDay {
	return {
		date,
		future: false,
		level: 0,
		completedAnswerCount: 0,
		hasActivity: false,
		activity: {
			date,
			answers: { study: 0, practice: 0, spelling: 0, challenge: 0 },
			completedAnswers: { study: 0, practice: 0, spelling: 0, challenge: 0 },
			completedSessions: { study: 0, practice: 0, spelling: 0, challenge: 0 },
			seconds: { study: 0, practice: 0, spelling: 0, challenge: 0, "word-list": 0 },
		},
	};
}

function ariaLabels(footprint: LearningFootprintSnapshot): string[] {
	const labels: string[] = [];
	const component = LearningFootprint as unknown as {
		type: (props: { footprint: LearningFootprintSnapshot }) => React.ReactNode;
	};
	function visit(node: React.ReactNode): void {
		React.Children.forEach(node, (child) => {
			if (!React.isValidElement(child)) return;
			const element = child as React.ReactElement<{
				children?: React.ReactNode;
				"aria-label"?: string;
				"data-heatmap-day"?: string;
			}>;
			// Only day cells: the panel also renders a window toggle, and the
			// assertion is about date labelling across time zones.
			if (element.type === "button" && element.props["data-heatmap-day"] !== undefined) {
				labels.push(element.props["aria-label"]!);
			}
			visit(element.props.children);
		});
	}
	visit(component.type({ footprint }));
	return labels;
}

describe("learning footprint calendar dates", () => {
	it.each([
		{ language: "en" as const, dates: ["Thu, Oct 1", "Sun, Nov 1"], months: ["Oct", "Nov"] },
		{
			language: "zh" as const,
			dates: ["10月1日周四", "11月1日周日"],
			months: ["10月", "11月"],
		},
	])(
		"keeps $language dates and months stable after a time zone change",
		({ language, dates, months }) => {
			locale.language = language;
			const zone = { name: "America/Los_Angeles", offset: "-07:00" };
			// Vitest workers do not reliably apply process.env.TZ changes. Model just
			// the two host seams instead: zone-less ISO parsing and Intl's default zone.
			// Native Date and Intl still perform all date arithmetic and localization.
			vi.stubGlobal(
				"Date",
				new Proxy(NativeDate, {
					construct(target, args) {
						const value = args[0];
						if (
							typeof value === "string" &&
							/^\d{4}-\d{2}-\d{2}T00:00:00$/.test(value)
						) {
							return new target(`${value}${zone.offset}`);
						}
						return Reflect.construct(target, args);
					},
				}),
			);
			const formatter = vi
				.spyOn(Intl, "DateTimeFormat")
				.mockImplementation(function (locales, options) {
					return new NativeDateTimeFormat(locales, {
						...options,
						timeZone: options?.timeZone ?? zone.name,
					});
				});
			const days = [day("2026-10-01"), day("2026-11-01")];
			const footprint: LearningFootprintSnapshot = {
				today: days[1]!.activity,
				todayTotalSeconds: 0,
				currentStreak: 0,
				bestStreak: 0,
				weeks: [{ days: [days[0]!] }, { days: [] }, { days: [days[1]!] }],
			};
			const expectedLabels = dates.map((date) =>
				createTranslator(language)("footprint.dayLabel", { date, count: 0 }),
			);
			expect(ariaLabels(footprint)).toEqual(expectedLabels);
			expect(calculateHeatmapMonthLabels(footprint.weeks, language)).toEqual([
				months[0],
				"",
				months[1],
			]);
			expect(formatter).toHaveBeenCalledTimes(2);

			zone.name = "Asia/Shanghai";
			zone.offset = "+08:00";
			expect.soft(ariaLabels(footprint)).toEqual(expectedLabels);
			expect(calculateHeatmapMonthLabels(footprint.weeks, language)).toEqual([
				months[0],
				"",
				months[1],
			]);
			// A host zone change must not require per-cell formatter reconstruction.
			expect(formatter).toHaveBeenCalledTimes(2);
		},
	);
});
