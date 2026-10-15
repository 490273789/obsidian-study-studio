import React from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Deck, StudyDayInfo } from "../../../../../core/shared/types";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { FlashcardInput } from "../../../../../core/ui/primitives/Input";
import { SetupSelector } from "../../../../../core/ui/primitives/SetupSelector";
import type {
	StudySetupPlan,
	PracticeSetupPlan,
	SpellingSetupPlan,
} from "../../../domain/sessions/sessionPlanner";
import { SetupPage } from "../../primitives/SetupPage/SetupPage";
import { StudySetup, StudyPlan, StudyDayRow } from "../Study/StudySetup";
import { PracticeSetup } from "../Practice/PracticeSetup";
import { SpellingSetup } from "../Spelling/SpellingSetup";

// Exercise React adapter events in node, without a browser renderer or effects.
const hooks = vi.hoisted(() => ({ cursor: 0, state: [] as unknown[] }));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useState: (initial: unknown) => {
		const index = hooks.cursor++;
		if (!(index in hooks.state))
			hooks.state[index] = typeof initial === "function" ? initial() : initial;
		return [
			hooks.state[index],
			(next: unknown) => {
				hooks.state[index] = typeof next === "function" ? next(hooks.state[index]) : next;
			},
		];
	},
	useMemo: (build: () => unknown) => build(),
	useCallback: (callback: unknown) => callback,
	useId: () => "study-plan",
	useEffect: () => {},
	useRef: () => ({ current: null }),
}));
vi.mock("../../../strings/context", () => ({
	useFlashcardI18n: () => ({ language: "en", t: (key: string) => key }),
}));

beforeEach(() => {
	hooks.cursor = 0;
	hooks.state = [];
});

type NodeProps = {
	children?: React.ReactNode;
	"aria-expanded"?: boolean;
	"aria-controls"?: string;
	id?: string;
	hidden?: boolean;
	onClick?: () => void;
	day?: StudyDayInfo;
};
function elements(node: React.ReactNode): React.ReactElement<NodeProps>[] {
	const result: React.ReactElement<NodeProps>[] = [];
	React.Children.forEach(node, (child) => {
		if (!React.isValidElement<NodeProps>(child)) return;
		result.push(child, ...elements(child.props.children));
	});
	return result;
}
function find<P>(node: React.ReactNode, type: unknown, index = 0): P {
	const matches = elements(node).filter((element) => element.type === type);
	if (!matches[index]) throw new Error("Expected setup element");
	return matches[index].props as P;
}
function renderMemo<P>(component: unknown, props: P): React.ReactNode {
	hooks.cursor = 0;
	return (component as { type: (props: P) => React.ReactNode }).type(props);
}
const deck: Deck = {
	id: "deck",
	name: "Deck",
	tag: "#words",
	filePath: "deck.md",
	cards: [],
	studyCount: 0,
	lastStudied: null,
};
function day(dayIndex: number, status: "done" | "today" | "future"): StudyDayInfo {
	return {
		dayIndex,
		startCardIndex: dayIndex * 30,
		endCardIndex: (dayIndex + 1) * 30,
		totalCards: 30,
		studiedCards: status === "done" ? 30 : 0,
		isCompleted: status === "done",
		isCurrent: status === "today",
		isLocked: status === "future",
	};
}
const studyPlan: StudySetupPlan = {
	dayList: [day(0, "done"), day(1, "today"), day(2, "future")],
	todayNewCount: 30,
	todayReviewCount: 5,
	completedDays: 1,
	allCompleted: false,
	hasAnythingToStudy: true,
	todayTotal: 35,
	defaultStudyOrder: "sequential",
};
const practicePlan: PracticeSetupPlan = {
	maxQuestions: 100,
	maxRangeStart: 100,
	defaultQuestionCount: 50,
	initialQuestionCount: 50,
	initialRangeStart: 1,
	initialRangeEnd: 50,
	initialSelectionMode: "random",
};
const spellingPlan: SpellingSetupPlan = {
	maxQuestions: 100,
	stats: { total: 100, unpracticed: 75 },
	defaultCount: 20,
	initialQuestionCount: 20,
	initialRangeStart: 1,
	initialRangeEnd: 20,
	initialSelectionMode: "smart",
};
type PageProps = React.ComponentProps<typeof SetupPage>;
type SelectorProps = { onChange: (value: string) => void };
type InputProps = {
	value: string | number;
	onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
	onBlur: () => void;
};
function change(input: InputProps, value: string): void {
	input.onChange({ target: { value } } as React.ChangeEvent<HTMLInputElement>);
}

describe("study plan disclosure and day actions", () => {
	it("always shows today, and connects the two collapsed groups to their regions", () => {
		const props = {
			deckId: deck.id,
			plan: studyPlan,
			direction: "normal" as const,
			spellingEnabled: true,
			onStartSession: vi.fn(),
		};
		const render = () => {
			hooks.cursor = 0;
			return StudyPlan(props);
		};
		let tree = render();
		const toggles = () => elements(tree).filter((element) => element.props["aria-controls"]);
		expect(toggles()).toHaveLength(2);
		expect(
			elements(tree)
				.filter((element) => element.type === StudyDayRow)
				.map((element) => element.props.day?.dayIndex),
		).toEqual([1]);
		for (const toggle of toggles()) {
			expect(toggle.props["aria-expanded"]).toBe(false);
			expect(
				elements(tree).find((element) => element.props.id === toggle.props["aria-controls"])
					?.props.hidden,
			).toBe(true);
		}
		toggles()[0]!.props.onClick!();
		tree = render();
		expect(toggles()[0]!.props["aria-expanded"]).toBe(true);
		expect(
			elements(tree)
				.filter((element) => element.type === StudyDayRow)
				.map((element) => element.props.day?.dayIndex)
				.sort((left, right) => left! - right!),
		).toEqual([0, 1]);
		toggles()[1]!.props.onClick!();
		tree = render();
		expect(elements(tree).filter((element) => element.type === StudyDayRow)).toHaveLength(3);
		expect(props.onStartSession).not.toHaveBeenCalled();
	});
	it("keeps completed-day review and spelling requests and no future-day actions", () => {
		const onStartSession = vi.fn();
		const props = {
			deckId: deck.id,
			day: day(0, "done"),
			direction: "reversed" as const,
			spellingEnabled: true,
			onStartSession,
		};
		const tree = renderMemo(StudyDayRow, props);
		find<{ onClick: () => void }>(tree, FlashcardButton, 0).onClick();
		find<{ onClick: () => void }>(tree, FlashcardButton, 1).onClick();
		expect(onStartSession.mock.calls.map(([request]) => request)).toEqual([
			{
				mode: "practice",
				deckId: "deck",
				direction: "reversed",
				selection: { kind: "study-day", dayIndex: 0, studyOrder: "random" },
			},
			{ mode: "spelling", deckId: "deck", selection: { kind: "study-day", dayIndex: 0 } },
		]);
		expect(
			elements(renderMemo(StudyDayRow, { ...props, day: day(2, "future") })).filter(
				(element) => element.type === FlashcardButton,
			),
		).toHaveLength(0);
		expect(
			elements(renderMemo(StudyDayRow, { ...props, spellingEnabled: false })).filter(
				(element) => element.type === FlashcardButton,
			),
		).toHaveLength(1);
	});
	it("supports a completely learned plan and an empty plan", () => {
		const props = {
			deckId: deck.id,
			plan: { ...studyPlan, dayList: [day(0, "done")], allCompleted: true },
			direction: "normal" as const,
			spellingEnabled: false,
			onStartSession: vi.fn(),
		};
		hooks.cursor = 0;
		const tree = StudyPlan(props);
		expect(elements(tree).filter((element) => element.props["aria-controls"])).toHaveLength(1);
		hooks.cursor = 0;
		expect(StudyPlan({ ...props, plan: { ...props.plan, dayList: [] } })).toBeNull();
	});
});

describe("setup selections and start requests", () => {
	it("updates study preferences and preserves completed and disabled startup rules", () => {
		const props = {
			deck,
			plan: studyPlan,
			spellingEnabled: true,
			onStartSession: vi.fn(),
			onBack: vi.fn(),
		};
		let tree = renderMemo(StudySetup, props);
		expect(find<PageProps>(tree, SetupPage).count).toBe(35);
		find<SelectorProps>(tree, SetupSelector, 0).onChange("random");
		find<SelectorProps>(tree, SetupSelector, 1).onChange("reversed");
		tree = renderMemo(StudySetup, props);
		find<PageProps>(tree, SetupPage).onStart();
		expect(props.onStartSession).toHaveBeenLastCalledWith({
			mode: "study",
			deckId: "deck",
			studyOrder: "random",
			direction: "reversed",
		});
		find<SelectorProps>(tree, SetupSelector, 0).onChange("sequential");
		tree = renderMemo(StudySetup, {
			...props,
			plan: { ...studyPlan, hasAnythingToStudy: false, allCompleted: true },
		});
		expect(find<PageProps>(tree, SetupPage).disabled).toBe(false);
		find<PageProps>(tree, SetupPage).onStart();
		expect(props.onStartSession).toHaveBeenLastCalledWith({
			mode: "study",
			deckId: "deck",
			studyOrder: "random",
			direction: "reversed",
		});
		tree = renderMemo(StudySetup, {
			...props,
			plan: { ...studyPlan, hasAnythingToStudy: false },
		});
		expect(find<PageProps>(tree, SetupPage).disabled).toBe(true);
		props.onStartSession.mockClear();
		find<PageProps>(tree, SetupPage).onStart();
		expect(props.onStartSession).not.toHaveBeenCalled();
	});
	it("updates practice quantity, normalizes custom input and preserves range direction", () => {
		const props = { deck, plan: practicePlan, onStartSession: vi.fn(), onBack: vi.fn() };
		let tree = renderMemo(PracticeSetup, props);
		const render = () => {
			tree = renderMemo(PracticeSetup, props);
		};
		find<{ onClick: () => void }>(tree, FlashcardButton, 0).onClick();
		render();
		expect(find<PageProps>(tree, SetupPage).count).toBe(20);
		change(find<InputProps>(tree, FlashcardInput), "200");
		render();
		find<InputProps>(tree, FlashcardInput).onBlur();
		render();
		expect(find<InputProps>(tree, FlashcardInput).value).toBe("100");
		expect(find<PageProps>(tree, SetupPage).count).toBe(100);
		find<PageProps>(tree, SetupPage).onStart();
		expect(props.onStartSession).toHaveBeenLastCalledWith({
			mode: "practice",
			deckId: "deck",
			direction: "normal",
			selection: { kind: "random", questionCount: 100 },
		});
		change(find<InputProps>(tree, FlashcardInput), "");
		render();
		find<InputProps>(tree, FlashcardInput).onBlur();
		render();
		expect(find<PageProps>(tree, SetupPage).count).toBe(1);
		find<SelectorProps>(tree, SetupSelector, 0).onChange("range");
		find<SelectorProps>(tree, SetupSelector, 1).onChange("reversed");
		render();
		change(find<InputProps>(tree, FlashcardInput, 0), "10");
		change(find<InputProps>(tree, FlashcardInput, 1), "200");
		render();
		find<InputProps>(tree, FlashcardInput, 0).onBlur();
		render();
		expect(find<PageProps>(tree, SetupPage).count).toBe(91);
		find<PageProps>(tree, SetupPage).onStart();
		expect(props.onStartSession).toHaveBeenLastCalledWith({
			mode: "practice",
			deckId: "deck",
			direction: "reversed",
			selection: { kind: "range", startIndex: 10, endIndex: 100 },
		});
	});
	it("updates spelling smart quantity and clamps range endpoints", () => {
		const props = { deck, plan: spellingPlan, onStartSession: vi.fn(), onBack: vi.fn() };
		let tree = renderMemo(SpellingSetup, props);
		const render = () => {
			tree = renderMemo(SpellingSetup, props);
		};
		find<{ onClick: () => void }>(tree, FlashcardButton, 2).onClick();
		render();
		expect(find<PageProps>(tree, SetupPage).count).toBe(50);
		find<PageProps>(tree, SetupPage).onStart();
		expect(props.onStartSession).toHaveBeenLastCalledWith({
			mode: "spelling",
			deckId: "deck",
			selection: { kind: "smart", questionCount: 50 },
		});
		find<SelectorProps>(tree, SetupSelector).onChange("range");
		render();
		change(find<InputProps>(tree, FlashcardInput, 0), "10");
		render();
		change(find<InputProps>(tree, FlashcardInput, 1), "200");
		render();
		expect(find<PageProps>(tree, SetupPage).count).toBe(91);
		find<PageProps>(tree, SetupPage).onStart();
		expect(props.onStartSession).toHaveBeenLastCalledWith({
			mode: "spelling",
			deckId: "deck",
			selection: { kind: "range", startIndex: 10, endIndex: 100 },
		});
	});
	it.each(["practice", "spelling"])("disables empty %s setup", (mode) => {
		const onStartSession = vi.fn();
		const common = { deck, onStartSession, onBack: vi.fn() };
		const tree =
			mode === "practice"
				? renderMemo(PracticeSetup, {
						...common,
						plan: { ...practicePlan, maxQuestions: 0, initialQuestionCount: 0 },
					})
				: renderMemo(SpellingSetup, {
						...common,
						plan: { ...spellingPlan, maxQuestions: 0, initialQuestionCount: 0 },
					});
		const page = find<PageProps>(tree, SetupPage);
		expect(page.disabled).toBe(true);
		page.onStart();
		expect(onStartSession).not.toHaveBeenCalled();
	});
});
