import React from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { FlashcardApp } from "../../../FlashcardApp";
import type { DeckHomeSnapshot } from "../../../../domain/decks/deckHome";
import { WordListView } from "../WordListView";

// Exercise the FlashcardApp/WordListView boundary in node: the app calls its real
// function body while hooks are adapted to a persistent per-render slot table.
const hooks = vi.hoisted(() => ({
	cursor: 0,
	slots: [] as Array<{ hasValue: boolean; value: unknown; deps?: readonly unknown[] }>,
}));

const navigationState = vi.hoisted(() => ({
	view: { type: "word-list", deckId: "notes/words.md" } as unknown,
}));

const presentationState = vi.hoisted(() => ({
	snapshot: {
		lifecycle: { kind: "idle" },
		activity: { kind: "idle" },
		cardMotion: null,
		cardPresentation: {},
		spellingFeedback: null,
	} as unknown,
}));

vi.mock("react", async (original) => {
	const actual = await original<typeof import("react")>();
	function sameDeps(a?: readonly unknown[], b?: readonly unknown[]): boolean {
		if (!a || !b) return a === b;
		if (a.length !== b.length) return false;
		return a.every((value, index) => Object.is(value, b[index]));
	}
	function memoized(build: () => unknown, deps?: readonly unknown[]): unknown {
		const slot = (hooks.slots[hooks.cursor++] ??= { hasValue: false, value: undefined });
		if (!slot.hasValue || !sameDeps(slot.deps, deps)) {
			slot.value = build();
			slot.deps = deps;
			slot.hasValue = true;
		}
		return slot.value;
	}
	return {
		...actual,
		useId: () => {
			const slot = (hooks.slots[hooks.cursor++] ??= { hasValue: false, value: undefined });
			if (!slot.hasValue) {
				slot.value = "flashcard-app";
				slot.hasValue = true;
			}
			return slot.value as string;
		},
		useMemo: memoized,
		useCallback: (callback: unknown, deps?: readonly unknown[]) =>
			memoized(() => callback, deps),
		useRef: (initial: unknown) => {
			const slot = (hooks.slots[hooks.cursor++] ??= { hasValue: false, value: undefined });
			if (!slot.hasValue) {
				slot.value = { current: initial };
				slot.hasValue = true;
			}
			return slot.value;
		},
		useLayoutEffect: () => {
			hooks.cursor++;
		},
		useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => {
			hooks.cursor++;
			return read();
		},
	};
});

vi.mock("obsidian", () => ({
	App: class {},
	Component: class {},
	MarkdownRenderer: { render: vi.fn() },
	Menu: class {},
	Modal: class {},
	Notice: class {},
	Platform: { isDesktop: true },
	Setting: class {},
	TFile: class {},
	normalizePath: (path: string) => path,
}));

vi.mock("../../../flashcardNavigation", () => ({
	FlashcardNavigation: class {
		challenge = vi.fn();
		setLanguage = vi.fn();
		mount = vi.fn();
		subscribe = vi.fn(() => () => {});
		getSnapshot = () => ({
			view: navigationState.view,
			confirmation: null,
			busy: false,
		});
		requestMigration = vi.fn(async () => true);
		start = vi.fn();
		home = vi.fn();
		stats = vi.fn();
		exit = vi.fn();
		result = vi.fn();
		startChallenge = vi.fn();
		respond = vi.fn();
		navigate = vi.fn();
	},
}));

vi.mock("../../../cardEditingInteraction", () => ({
	CardEditingInteraction: class {
		setLanguage = vi.fn();
		mount = vi.fn();
		subscribe = vi.fn(() => () => {});
		getSnapshot = () => ({ editor: null });
		openCreate = vi.fn();
		openEdit = vi.fn();
		delete = vi.fn();
		save = vi.fn();
		close = vi.fn();
	},
}));

vi.mock("../../../answerPresentationTransition", () => ({
	createAnswerPresentationTransition: () => ({
		setWordLearningDecks: vi.fn(),
		subscribe: vi.fn(() => () => {}),
		getSnapshot: () => presentationState.snapshot,
	}),
}));

interface WordListProps {
	deck: { id: string };
	onBack: () => void;
	onRecordVisit?: (startTimeMs: number, endTimeMs: number) => void;
}

const DECK_A = { id: "notes/words.md", name: "Words" };
const DECK_B = { id: "notes/other.md", name: "Other" };

function snapshot(decks: (typeof DECK_A)[]): DeckHomeSnapshot {
	return {
		revision: 1,
		evaluatedAt: 0,
		decks: decks as unknown as DeckHomeSnapshot["decks"],
		studyHistory: [],
		challenge: { savedRoundId: null, eligibleCount: 0, lastMode: "random", round: null },
	} as unknown as DeckHomeSnapshot;
}

function makeDeckHome(decks: (typeof DECK_A)[]) {
	const act = vi.fn(async () => ({ kind: "applied" }));
	const home = {
		getSnapshot: () => snapshot(decks),
		subscribe: vi.fn(() => () => {}),
		getDeck: (deckId: string) => decks.find((deck) => deck.id === deckId),
		act,
	} as unknown as React.ComponentProps<typeof FlashcardApp>["deckHome"];
	return { home, act };
}

function findWordListView(node: React.ReactNode): React.ReactElement<WordListProps> {
	let found: React.ReactElement<WordListProps> | undefined;
	function visit(children: React.ReactNode): void {
		React.Children.forEach(children, (child) => {
			if (found || !React.isValidElement<{ children?: React.ReactNode }>(child)) return;
			if (child.type === WordListView) {
				found = child as React.ReactElement<WordListProps>;
				return;
			}
			visit(child.props.children);
		});
	}
	visit(node);
	if (!found) throw new Error("Expected a WordListView in the rendered tree");
	return found;
}

function propsFor(deckHome: React.ComponentProps<typeof FlashcardApp>["deckHome"]) {
	return {
		app: {},
		modalHost: {},
		sessionLifecycle: {},
		cardIdentityContinuity: {},
		pronunciationRuntime: {},
		deckHome,
		settings: { language: "en", wordLearningDecks: {} },
		onOpenSettings: vi.fn(),
	} as unknown as React.ComponentProps<typeof FlashcardApp>;
}

const renderApp = FlashcardApp as unknown as (
	props: React.ComponentProps<typeof FlashcardApp>,
) => React.ReactNode;

function render(props: React.ComponentProps<typeof FlashcardApp>): React.ReactNode {
	hooks.cursor = 0;
	return renderApp(props);
}

describe("FlashcardApp word-list visit recording", () => {
	beforeEach(() => {
		hooks.cursor = 0;
		hooks.slots = [];
		navigationState.view = { type: "word-list", deckId: DECK_A.id };
	});

	it("hands the memoized word list a stable visit callback across unrelated renders", () => {
		const { home, act } = makeDeckHome([DECK_A]);
		const props = propsFor(home);

		const first = findWordListView(render(props));
		const second = findWordListView(render(props));
		expect(second.props.onRecordVisit).toBe(first.props.onRecordVisit);

		second.props.onRecordVisit?.(1_000, 2_000);
		expect(act).toHaveBeenCalledWith({
			kind: "record-word-list-visit",
			deckId: DECK_A.id,
			startTimeMs: 1_000,
			endTimeMs: 2_000,
		});
	});

	it("replaces the visit callback when the word-list deck changes", () => {
		const { home, act } = makeDeckHome([DECK_A, DECK_B]);
		const props = propsFor(home);

		const first = findWordListView(render(props));
		navigationState.view = { type: "word-list", deckId: DECK_B.id };
		const second = findWordListView(render(props));
		expect(second.props.onRecordVisit).not.toBe(first.props.onRecordVisit);

		second.props.onRecordVisit?.(3_000, 4_000);
		expect(act).toHaveBeenCalledWith({
			kind: "record-word-list-visit",
			deckId: DECK_B.id,
			startTimeMs: 3_000,
			endTimeMs: 4_000,
		});
	});
});
