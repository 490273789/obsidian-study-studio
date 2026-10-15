import React from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { FlashcardInput } from "../../../../../core/ui/primitives/Input";
import type { PronunciationRuntime } from "../../../domain/pronunciation";
import type {
	ActiveStudySnapshot,
	ActivePracticeSnapshot,
	ActiveSpellingSnapshot,
	ActiveChallengeSnapshot,
	SpellingLifecycleFeedback,
} from "../../../domain/sessions/sessionLifecycle";
import type { AnswerPresentationTransition } from "../../answerPresentationTransition";
import { MarkdownContent, PronounceableMarkdown } from "../../primitives/Markdown";
import { SessionToolbar } from "../../primitives/SessionToolbar";
import { CardView } from "../Card/CardView";
import { PracticeView } from "../Practice/PracticeView";
import { SpellingView } from "../Spelling/SpellingView";
import { ChallengeView } from "../Challenge/ChallengeView";

// Exercise view adapters and slot content in node; effects and DOM renderers are external seams.
const hooks = vi.hoisted(() => ({ cursor: 0, state: [] as unknown[] }));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useState: (initial: unknown) => {
		const index = hooks.cursor++;
		if (!(index in hooks.state)) hooks.state[index] = initial;
		return [
			hooks.state[index],
			(next: unknown) => {
				hooks.state[index] = next;
			},
		];
	},
	useMemo: (build: () => unknown) => build(),
	useCallback: (callback: unknown) => callback,
	useId: () => "spelling-feedback",
	useEffect: () => {},
	useRef: () => ({ current: null }),
}));
vi.mock("obsidian", () => ({ Notice: vi.fn() }));
vi.mock("../../../strings/context", () => ({
	useFlashcardI18n: () => ({ language: "en", t: (key: string) => key }),
}));
vi.mock("../../primitives/Markdown", () => ({
	MarkdownContent: () => null,
	PronounceableMarkdown: () => null,
}));
vi.mock("../../hooks/useCardContextMenu", () => ({ useCardContextMenu: () => vi.fn() }));
vi.mock("../../hooks/useCardPresentationShortcuts", () => ({
	useCardPresentationShortcuts: () => ({ current: null }),
}));

beforeEach(() => {
	hooks.cursor = 0;
	hooks.state = [];
});

type NodeProps = {
	children?: React.ReactNode;
	header?: React.ReactNode;
	footer?: React.ReactNode;
	content?: string;
	id?: string;
	role?: string;
};
function elements(node: React.ReactNode): React.ReactElement<NodeProps>[] {
	const result: React.ReactElement<NodeProps>[] = [];
	React.Children.forEach(node, (child) => {
		if (!React.isValidElement<NodeProps>(child)) return;
		result.push(
			child,
			...elements(child.props.header),
			...elements(child.props.children),
			...elements(child.props.footer),
		);
	});
	return result;
}
function find<P>(node: React.ReactNode, type: unknown, index = 0): P {
	const matches = elements(node).filter((element) => element.type === type);
	if (!matches[index]) throw new Error("Expected session element");
	return matches[index].props as P;
}
function renderMemo<P>(component: unknown, props: P): React.ReactNode {
	hooks.cursor = 0;
	return (component as { type: (props: P) => React.ReactNode }).type(props);
}
function markdown(node: React.ReactNode): (string | undefined)[] {
	return elements(node)
		.filter(
			(element) => element.type === MarkdownContent || element.type === PronounceableMarkdown,
		)
		.map((element) => element.props.content);
}
type ButtonProps = React.ComponentProps<typeof FlashcardButton>;
function buttons(node: React.ReactNode): ButtonProps[] {
	return elements(node)
		.filter((element) => element.type === FlashcardButton)
		.map((element) => element.props as ButtonProps);
}
async function click(button: ButtonProps): Promise<void> {
	button.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
	await Promise.resolve();
}
const base = {
	kind: "active" as const,
	revision: 1,
	originDeck: { id: "deck", name: "Words" },
	startTime: 100,
	currentCard: {
		identity: "card",
		currentDeckId: "deck",
		front: "front",
		back: "back",
		explanation: "explanation",
		sourceFile: "deck.md",
		indexInFile: 0,
	},
	progress: { current: 1, completed: 0, total: 10, percent: 0, label: "1/10" },
	answerEventCount: 1,
};
const study: ActiveStudySnapshot = {
	...base,
	mode: "study",
	reference: { kind: "active", mode: "study", revision: 1, key: "study" },
	direction: "normal",
	canPrevious: true,
};
const practice: ActivePracticeSnapshot = {
	...base,
	mode: "practice",
	reference: { kind: "active", mode: "practice", revision: 1, key: "practice" },
	direction: "normal",
	canPrevious: true,
};
const spelling: ActiveSpellingSnapshot = {
	...base,
	mode: "spelling",
	reference: { kind: "active", mode: "spelling", revision: 1, key: "spelling" },
	phase: "retrieval",
};
const challenge: ActiveChallengeSnapshot = {
	...base,
	mode: "challenge",
	reference: { kind: "active", mode: "challenge", revision: 1, key: "challenge" },
	sourceDeck: base.originDeck,
	questionMode: "normal",
	phase: "question",
	feedback: null,
	removedCardCount: 1,
	roundProgress: {
		level: 2,
		totalLevels: 5,
		passedInLevel: 0,
		currentLevelTotal: 10,
		completedAcrossRound: 10,
		totalAcrossRound: 50,
	},
};
function fixture() {
	const act = vi
		.fn<AnswerPresentationTransition["act"]>()
		.mockResolvedValue({ kind: "applied", studyCompleted: false });
	const transition: AnswerPresentationTransition = {
		act,
		getSnapshot: () => {
			throw new Error("View must use its presented snapshot");
		},
		subscribe: () => () => {},
		setWordLearningDecks: vi.fn(),
	};
	const common = {
		transition,
		isTransitioning: false,
		onEditCard: vi.fn(),
		onDeleteCard: vi.fn(),
		onClose: vi.fn(),
		markdownRenderer: vi.fn<(content: string, el: HTMLElement) => Promise<void>>(),
		// Effects and pronunciation children are mocked, so only stop is used at this seam.
		pronunciationRuntime: { stop: vi.fn() } as unknown as PronunciationRuntime,
	};
	const cardPresentation = {
		answerVisible: false,
		autoPronunciationEnabled: false,
		pronunciationEnabled: true,
		pronunciationWord: "front",
	};
	return { act, common, cardPresentation };
}

describe("study and practice presentation", () => {
	it.each(["study", "practice"] as const)(
		"does not expose the %s answer until revealed, including reverse cards",
		async (mode) => {
			const { act, common, cardPresentation } = fixture();
			for (const direction of ["normal", "reversed"] as const) {
				const tree =
					mode === "study"
						? renderMemo(CardView, {
								...common,
								cardPresentation,
								session: { ...study, direction },
								onComplete: vi.fn(),
							})
						: renderMemo(PracticeView, {
								...common,
								cardPresentation,
								session: { ...practice, direction },
							});
				expect(markdown(tree)).toEqual([direction === "normal" ? "front" : "back"]);
				expect(buttons(tree)).toHaveLength(1);
				await click(buttons(tree)[0]!);
				expect(act).toHaveBeenLastCalledWith({
					kind: "card-reveal",
					reference: mode === "study" ? study.reference : practice.reference,
				});
			}
		},
	);
	it("dispatches all five study ratings and undo with the presented reference", async () => {
		const { act, common, cardPresentation } = fixture();
		const onComplete = vi.fn();
		const tree = renderMemo(CardView, {
			...common,
			session: study,
			onComplete,
			cardPresentation: { ...cardPresentation, answerVisible: true },
		});
		expect(markdown(tree)).toEqual(["front", "back", "explanation"]);
		for (const button of buttons(tree)) await click(button);
		expect(act.mock.calls.map(([action]) => action)).toEqual([
			{ kind: "study-previous", reference: study.reference },
			...[1, 2, 3, 4, 5].map((rating) => ({
				kind: "study-answer",
				reference: study.reference,
				rating,
			})),
		]);
		expect(onComplete).not.toHaveBeenCalled();
		act.mockResolvedValueOnce({ kind: "applied", studyCompleted: true });
		await click(buttons(tree)[1]!);
		expect(onComplete).toHaveBeenCalledOnce();
	});
	it("dispatches practice undo, wrong and correct, and keeps edit/delete attached to the current card", async () => {
		const { act, common, cardPresentation } = fixture();
		const tree = renderMemo(PracticeView, {
			...common,
			session: practice,
			cardPresentation: { ...cardPresentation, answerVisible: true },
		});
		expect(markdown(tree)).toEqual(["front", "back", "explanation"]);
		for (const button of buttons(tree)) await click(button);
		expect(act.mock.calls.map(([action]) => action)).toEqual([
			{ kind: "practice-previous", reference: practice.reference },
			{ kind: "practice-answer", reference: practice.reference, correct: false },
			{ kind: "practice-answer", reference: practice.reference, correct: true },
		]);
		const toolbar = find<React.ComponentProps<typeof SessionToolbar>>(tree, SessionToolbar);
		toolbar.onEdit?.();
		toolbar.onDelete?.();
		expect(common.onEditCard).toHaveBeenCalledWith("deck", "card");
		expect(common.onDeleteCard).toHaveBeenCalledWith("deck", "card");
		toolbar.autoPronunciation?.onToggle();
		expect(act).toHaveBeenLastCalledWith({
			kind: "card-toggle-auto-pronunciation",
			reference: practice.reference,
		});
	});
	it.each(["study", "practice"] as const)(
		"guards %s reveal and pronunciation toggle while busy",
		async (mode) => {
			const { act, common, cardPresentation } = fixture();
			const props = { ...common, isTransitioning: true, cardPresentation };
			const tree =
				mode === "study"
					? renderMemo(CardView, { ...props, session: study, onComplete: vi.fn() })
					: renderMemo(PracticeView, { ...props, session: practice });
			expect(buttons(tree)[0]!.disabled).toBe(true);
			await click(buttons(tree)[0]!);
			find<React.ComponentProps<typeof SessionToolbar>>(
				tree,
				SessionToolbar,
			).autoPronunciation?.onToggle();
			expect(act).not.toHaveBeenCalled();
			expect(markdown(tree)).toEqual(["front"]);
		},
	);
	it.each(["study", "practice"] as const)(
		"disables and guards revealed %s actions while busy",
		async (mode) => {
			const { act, common, cardPresentation } = fixture();
			const props = {
				...common,
				isTransitioning: true,
				cardPresentation: { ...cardPresentation, answerVisible: true },
			};
			const tree =
				mode === "study"
					? renderMemo(CardView, { ...props, session: study, onComplete: vi.fn() })
					: renderMemo(PracticeView, { ...props, session: practice });
			for (const button of buttons(tree)) {
				expect(button.disabled).toBe(true);
				await click(button);
			}
			expect(act).not.toHaveBeenCalled();
			expect(
				find<React.ComponentProps<typeof SessionToolbar>>(tree, SessionToolbar).busy,
			).toBe(true);
		},
	);
});

function typeInput(tree: React.ReactNode, value: string): void {
	find<React.ComponentProps<typeof FlashcardInput>>(tree, FlashcardInput).onChange?.({
		target: { value },
	} as React.ChangeEvent<HTMLInputElement>);
}
function enter(tree: React.ReactNode, options: { isComposing?: boolean; repeat?: boolean } = {}) {
	const preventDefault = vi.fn();
	find<React.ComponentProps<typeof FlashcardInput>>(tree, FlashcardInput).onKeyDown?.({
		key: "Enter",
		nativeEvent: { isComposing: options.isComposing ?? false },
		repeat: options.repeat ?? false,
		preventDefault,
	} as unknown as React.KeyboardEvent<HTMLInputElement>);
	return preventDefault;
}

describe("spelling retrieval and correction", () => {
	it("submits unknown only during retrieval, and ignores empty, IME and repeated Enter", async () => {
		const { act, common } = fixture();
		const render = () =>
			renderMemo(SpellingView, { ...common, session: spelling, feedback: null });
		let tree = render();
		expect(markdown(tree)).toEqual(["back"]);
		expect(buttons(tree)).toHaveLength(2);
		expect(buttons(tree)[1]!.disabled).toBe(true);
		enter(tree);
		expect(act).not.toHaveBeenCalled();
		await click(buttons(tree)[0]!);
		expect(act).toHaveBeenLastCalledWith({
			kind: "spelling-answer",
			reference: spelling.reference,
			input: "",
		});
		act.mockClear();
		typeInput(tree, "front");
		tree = render();
		expect(enter(tree, { isComposing: true })).not.toHaveBeenCalled();
		expect(enter(tree, { repeat: true })).not.toHaveBeenCalled();
		expect(act).not.toHaveBeenCalled();
		expect(enter(tree)).toHaveBeenCalledOnce();
		expect(act).toHaveBeenCalledExactlyOnceWith({
			kind: "spelling-answer",
			reference: spelling.reference,
			input: "front",
		});
	});
	it("connects incorrect feedback to the correction input and preserves the explanation then correction order", async () => {
		const { act, common } = fixture();
		const feedback: SpellingLifecycleFeedback = {
			kind: "retrieval-incorrect",
			submittedInput: "fron",
			expectedAnswer: "front",
			diff: [{ kind: "missing", value: "t", expected: "t" }],
		};
		const props = {
			...common,
			session: { ...spelling, phase: "correction" as const },
			feedback,
		};
		let tree = renderMemo(SpellingView, props);
		const input = find<React.ComponentProps<typeof FlashcardInput>>(tree, FlashcardInput);
		expect(input["aria-invalid"]).toBe(true);
		const nodes = elements(tree);
		const feedbackIndex = nodes.findIndex((element) => element.props.role === "status");
		const inputIndex = nodes.findIndex((element) => element.type === FlashcardInput);
		const explanationIndex = nodes.findIndex(
			(element) => element.props.content === "explanation",
		);
		expect(nodes[feedbackIndex]!.props.id).toBe(input["aria-describedby"]);
		expect(feedbackIndex).toBeLessThan(inputIndex);
		expect(explanationIndex).toBeLessThan(inputIndex);
		expect(buttons(tree)).toHaveLength(1);
		expect(buttons(tree)[0]!.children).toBe("spelling.confirmCorrection");
		typeInput(tree, "front");
		tree = renderMemo(SpellingView, props);
		await click(buttons(tree)[0]!);
		expect(act).toHaveBeenCalledExactlyOnceWith({
			kind: "spelling-answer",
			reference: spelling.reference,
			input: "front",
		});
	});
	it("guards submission and input while a transition is pending", async () => {
		const { act, common } = fixture();
		const props = { ...common, session: spelling, feedback: null };
		typeInput(renderMemo(SpellingView, props), "front");
		const tree = renderMemo(SpellingView, { ...props, isTransitioning: true });
		expect(
			find<React.ComponentProps<typeof FlashcardInput>>(tree, FlashcardInput).disabled,
		).toBe(true);
		for (const button of buttons(tree)) {
			expect(button.disabled).toBe(true);
			await click(button);
		}
		enter(tree);
		expect(act).not.toHaveBeenCalled();
	});
});

function renderChallenge(props: React.ComponentProps<typeof ChallengeView>): React.ReactNode {
	const wrapper = renderMemo(ChallengeView, props) as React.ReactElement<
		React.ComponentProps<typeof ChallengeView>
	>;
	return renderMemo(wrapper.type, wrapper.props);
}

describe("challenge questions and feedback", () => {
	it("does not reveal a challenge answer while busy", async () => {
		const { act, common } = fixture();
		const props = { ...common, isTransitioning: true, session: challenge };
		let tree = renderChallenge(props);
		expect(buttons(tree)[0]!.disabled).toBe(true);
		await click(buttons(tree)[0]!);
		tree = renderChallenge(props);
		expect(markdown(tree)).toEqual(["front"]);
		expect(act).not.toHaveBeenCalled();
	});
	it.each(["normal", "reversed"] as const)(
		"reveals the %s answer locally, then dispatches a result without edit tools",
		async (questionMode) => {
			const { act, common } = fixture();
			const props = { ...common, session: { ...challenge, questionMode } };
			let tree = renderChallenge(props);
			expect(markdown(tree)).toEqual([questionMode === "normal" ? "front" : "back"]);
			const toolbar = find<React.ComponentProps<typeof SessionToolbar>>(tree, SessionToolbar);
			expect(toolbar.onEdit).toBeUndefined();
			expect(toolbar.onDelete).toBeUndefined();
			expect(buttons(tree)).toHaveLength(1);
			await click(buttons(tree)[0]!);
			expect(act).not.toHaveBeenCalled();
			tree = renderChallenge(props);
			expect(markdown(tree)).toEqual([
				questionMode === "normal" ? "front" : "back",
				questionMode === "normal" ? "back" : "front",
				"explanation",
			]);
			const revealedButtons = buttons(tree);
			expect(revealedButtons).toHaveLength(2);
			expect(revealedButtons[0]!.className).toContain("btnWrong");
			expect(revealedButtons[1]!.className).toContain("btnCorrect");
			await click(revealedButtons[1]!);
			expect(act).toHaveBeenCalledExactlyOnceWith({
				kind: "challenge-answer",
				reference: challenge.reference,
				correct: true,
			});
		},
	);
	it("dispatches challenge wrong answer on clicking wrong button", async () => {
		const { act, common } = fixture();
		const props = { ...common, session: challenge };
		let tree = renderChallenge(props);
		await click(buttons(tree)[0]!);
		tree = renderChallenge(props);
		const revealedButtons = buttons(tree);
		expect(revealedButtons).toHaveLength(2);
		await click(revealedButtons[0]!);
		expect(act).toHaveBeenCalledExactlyOnceWith({
			kind: "challenge-answer",
			reference: challenge.reference,
			correct: false,
		});
	});
	it("offers only continue during error feedback and guards it while busy", async () => {
		const { act, common } = fixture();
		const props = {
			...common,
			session: {
				...challenge,
				phase: "feedback" as const,
				feedback: { correct: false as const },
			},
		};
		let tree = renderChallenge(props);
		expect(markdown(tree)).toEqual(["front", "back", "explanation"]);
		expect(
			elements(tree).some(
				(element) => element.type === "output" || element.props.role === "status",
			),
		).toBe(true);
		expect(buttons(tree)).toHaveLength(1);
		expect(buttons(tree)[0]!.children).toBe("challenge.continueAnswer");
		await click(buttons(tree)[0]!);
		expect(act).toHaveBeenCalledExactlyOnceWith({
			kind: "challenge-continue",
			reference: challenge.reference,
		});
		act.mockClear();
		tree = renderChallenge({ ...props, isTransitioning: true });
		expect(buttons(tree)[0]!.disabled).toBe(true);
		await click(buttons(tree)[0]!);
		expect(act).not.toHaveBeenCalled();
	});
	it("uses spelling input without revealing answers and filters IME/repeat submissions", async () => {
		const { act, common } = fixture();
		const props = { ...common, session: { ...challenge, questionMode: "spelling" as const } };
		let tree = renderChallenge(props);
		expect(markdown(tree)).toEqual(["back"]);
		await click(buttons(tree)[0]!);
		expect(act).toHaveBeenLastCalledWith({
			kind: "challenge-reveal",
			reference: challenge.reference,
		});
		act.mockClear();
		typeInput(tree, "front");
		tree = renderChallenge(props);
		enter(tree, { isComposing: true });
		enter(tree, { repeat: true });
		expect(act).not.toHaveBeenCalled();
		enter(tree);
		expect(act).toHaveBeenCalledExactlyOnceWith({
			kind: "challenge-answer",
			reference: challenge.reference,
			input: "front",
		});
		act.mockClear();
		tree = renderChallenge({ ...props, isTransitioning: true });
		for (const button of buttons(tree)) {
			expect(button.disabled).toBe(true);
			await click(button);
		}
		enter(tree);
		expect(act).not.toHaveBeenCalled();
	});
});
