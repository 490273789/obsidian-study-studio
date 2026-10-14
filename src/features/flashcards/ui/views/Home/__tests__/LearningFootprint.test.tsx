import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type {
	LearningFootprintDay,
	LearningFootprintSnapshot,
} from "../../../../domain/history/dailyLearningActivity";
import { createTranslator } from "../../../../strings";
import { LearningFootprint, calculateHeatmapMonthLabels } from "../LearningFootprint";

const locale = vi.hoisted(() => ({ language: "en" as "zh" | "en" }));
const hooks = vi.hoisted(() => ({ cursor: 0, id: 0, state: [] as unknown[] }));

// Inspect the real component's emitted accessibility props without a DOM reconciler.
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useEffect: () => {},
	useId: () => `footprint-${hooks.id++}`,
	useMemo: (factory: () => unknown) => factory(),
	useRef: (current: unknown) => ({ current }),
	useState: (initial: unknown) => {
		const index = hooks.cursor++;
		if (!(index in hooks.state)) hooks.state[index] = initial;
		return [
			hooks.state[index],
			(next: unknown) => {
				hooks.state[index] = typeof next === "function" ? next(hooks.state[index]) : next;
			},
		];
	},
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

beforeEach(() => {
	hooks.cursor = 0;
	hooks.id = 0;
	hooks.state = [];
});

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

function renderFootprint(footprint: LearningFootprintSnapshot): React.ReactNode {
	hooks.cursor = 0;
	hooks.id = 0;
	const component = LearningFootprint as unknown as {
		type: (props: { footprint: LearningFootprintSnapshot }) => React.ReactNode;
	};
	return component.type({ footprint });
}

interface ElementProps {
	children?: React.ReactNode;
	id?: string;
	"aria-label"?: string;
	"aria-controls"?: string;
	"aria-expanded"?: boolean;
	hidden?: boolean;
	"data-heatmap-day"?: string;
	tabIndex?: number;
	onClick?: () => void;
	onKeyDown?: (event: { key: string; preventDefault(): void }) => void;
	ref?: (node: { focus(): void }) => void;
}

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
	const result: React.ReactElement<ElementProps>[] = [];
	function visit(node: React.ReactNode): void {
		React.Children.forEach(node, (child) => {
			if (!React.isValidElement<ElementProps>(child)) return;
			result.push(child);
			visit(child.props.children);
		});
	}
	visit(node);
	return result;
}

function ariaLabels(footprint: LearningFootprintSnapshot): string[] {
	return elements(renderFootprint(footprint))
		.filter((element) => element.props["data-heatmap-day"] !== undefined)
		.map((element) => element.props["aria-label"]!);
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

describe("learning footprint window disclosure", () => {
	function harness() {
		const days = Array.from({ length: 16 * 7 }, (_, index) =>
			day(new NativeDate(Date.UTC(2026, 0, 5 + index)).toISOString().slice(0, 10)),
		);
		const footprint: LearningFootprintSnapshot = {
			today: days.slice(-1)[0]!.activity,
			todayTotalSeconds: 0,
			currentStreak: 0,
			bestStreak: 0,
			weeks: Array.from({ length: 16 }, (_, index) => ({
				days: days.slice(index * 7, index * 7 + 7),
			})),
		};
		let tree: React.ReactNode;
		const render = () => {
			tree = renderFootprint(footprint);
		};
		const cells = () =>
			elements(tree).filter((element) => element.props["data-heatmap-day"] !== undefined);
		const toggle = () =>
			elements(tree).find(
				(element) =>
					element.props["aria-expanded"] !== undefined &&
					element.props["aria-label"] === undefined,
			)!;
		const panelToggle = () =>
			elements(tree).find(
				(element) =>
					element.props["aria-expanded"] !== undefined &&
					element.props["aria-label"] ===
						createTranslator(locale.language)("footprint.title"),
			)!;
		const selectedDate = () =>
			cells().find((cell) => cell.props.tabIndex === 0)?.props["data-heatmap-day"];
		render();
		return { days, render, cells, toggle, panelToggle, selectedDate, tree: () => tree };
	}

	it("starts collapsed and preserves the heading summary and selection across toggles", () => {
		const h = harness();
		const body = () =>
			elements(h.tree()).find(
				(element) => element.props.id === h.panelToggle().props["aria-controls"],
			)!;
		expect(h.panelToggle().props["aria-expanded"]).toBe(false);
		expect(body().props.hidden).toBe(true);
		h.panelToggle().props.onClick!();
		h.render();
		expect(h.panelToggle().props["aria-expanded"]).toBe(true);
		expect(body().props.hidden).toBe(false);
		h.toggle().props.onClick!();
		h.render();
		const selected = h.days.slice(-8)[0]!.date;
		h.cells().find((cell) => cell.props["data-heatmap-day"] === selected)!.props.onClick!();
		h.render();
		h.panelToggle().props.onClick!();
		h.render();
		expect(h.panelToggle().props["aria-expanded"]).toBe(false);
		expect(body().props.hidden).toBe(true);
		const header = elements(h.tree()).find((element) => element.type === "header")!;
		expect(elements(header).some((element) => element.type === "h2")).toBe(true);
		const text = elements(header)
			.flatMap((element) => React.Children.toArray(element.props.children))
			.filter((child) => typeof child === "string" || typeof child === "number")
			.join("");
		expect(text).toContain(createTranslator(locale.language)("footprint.totalDuration"));
		expect(text).toContain(createTranslator(locale.language)("footprint.studyAnswers"));
		h.panelToggle().props.onClick!();
		h.render();
		expect(body().props.hidden).toBe(false);
		expect(h.toggle().props["aria-expanded"]).toBe(true);
		expect(h.selectedDate()).toBe(selected);
	});

	it("expands the recent 14 weeks without changing the selected date", () => {
		const h = harness();
		h.panelToggle().props.onClick!();
		h.render();
		expect(h.cells()).toHaveLength(14 * 7);
		expect(h.toggle().props["aria-expanded"]).toBe(false);
		expect(
			elements(h.tree()).some(
				(element) => element.props.id === h.toggle().props["aria-controls"],
			),
		).toBe(true);
		const selected = h.days.slice(-8)[0]!.date;
		h.cells().find((cell) => cell.props["data-heatmap-day"] === selected)!.props.onClick!();
		h.render();
		h.toggle().props.onClick!();
		h.render();
		expect(h.toggle().props["aria-expanded"]).toBe(true);
		expect(h.cells()).toHaveLength(16 * 7);
		expect(h.selectedDate()).toBe(selected);
		h.toggle().props.onClick!();
		h.render();
		expect(h.cells()).toHaveLength(14 * 7);
		expect(h.selectedDate()).toBe(selected);
	});

	it("keeps arrow-key focus navigation and clamps it at today", () => {
		const h = harness();
		h.panelToggle().props.onClick!();
		h.render();
		const previousWeek = h.cells().slice(-8)[0]!;
		const focus = vi.fn();
		previousWeek.props.ref!({ focus });
		const preventDefault = vi.fn();
		h.cells().slice(-1)[0]!.props.onKeyDown!({ key: "ArrowLeft", preventDefault });
		h.render();
		expect(h.selectedDate()).toBe(h.days.slice(-8)[0]!.date);
		expect(focus).toHaveBeenCalledOnce();
		expect(preventDefault).toHaveBeenCalledOnce();
		h.cells().slice(-8)[0]!.props.onKeyDown!({ key: "ArrowRight", preventDefault });
		h.render();
		h.cells().slice(-1)[0]!.props.onKeyDown!({ key: "ArrowRight", preventDefault });
		h.render();
		expect(h.selectedDate()).toBe(h.days.slice(-1)[0]!.date);
	});
});
