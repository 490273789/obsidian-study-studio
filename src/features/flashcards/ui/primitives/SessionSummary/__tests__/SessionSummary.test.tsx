import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { FlashcardButtonProps } from "../../../../../../core/ui/primitives/Button";
import type {
	ChallengeResultSnapshot,
	PracticeResultSnapshot,
	SpellingResultSnapshot,
	StudyResultSnapshot,
} from "../../../../domain/sessions/sessionLifecycle";
import { StudySummary } from "../../../views/Study/StudySummary";
import { PracticeSummary } from "../../../views/Practice/PracticeSummary";
import { SpellingSummary } from "../../../views/Spelling/SpellingSummary";
import { ChallengeSummary } from "../../../views/Challenge/ChallengeSummary";
import { focusSessionSummary, handleSessionSummaryKeyDown } from "../sessionSummaryKeyboard";

const { buttons } = vi.hoisted(() => ({ buttons: [] as FlashcardButtonProps[] }));
vi.mock("../../../../../../core/ui/primitives/Button", () => ({
	FlashcardButton: (props: FlashcardButtonProps) => {
		buttons.push(props);
		return <button>{props.children}</button>;
	},
}));
vi.mock("../../../../../../core/ui/primitives/Header", () => ({
	FlashcardHeader: () => <header />,
}));
vi.mock("../../../../../../core/ui/primitives/Confetti", () => ({ Confetti: () => null }));
vi.mock("../../Markdown", () => ({ MarkdownContent: () => <div /> }));
vi.mock("../../Markdown/MarkdownContent", () => ({ MarkdownContent: () => <div /> }));
vi.mock("../../../../strings/context", () => ({
	useFlashcardI18n: () => ({ language: "zh", t: (key: string) => key }),
}));

function primaryButton() {
	const primary = buttons.filter((button) => button.variant === "primary");
	expect(primary).toHaveLength(1);
	return primary[0]!;
}

const markdownRenderer = async () => {};

function makeSummaryRoot(focused = true, modal = false): HTMLElement {
	return {
		isConnected: true,
		closest: vi.fn(() => null),
		contains: vi.fn(() => focused),
		focus: vi.fn(),
		ownerDocument: {
			activeElement: null,
			body: null,
			querySelector: vi.fn(() => (modal ? {} : null)),
		},
	} as unknown as HTMLElement;
}

describe("session result actions", () => {
	beforeEach(() => {
		buttons.length = 0;
	});

	it.each([0, 2])(
		"practice prioritizes home or incorrect retry (%i incorrect)",
		(incorrectCount) => {
			const onHome = vi.fn();
			const onRetry = vi.fn();
			const result = {
				originDeck: { name: "Deck" },
				totalQuestions: 4,
				correctCount: 4 - incorrectCount,
				incorrectCount,
				accuracy: 50,
				timeSpent: 5,
				incorrectCards: [],
				direction: "forward",
			} as unknown as PracticeResultSnapshot;
			renderToStaticMarkup(
				<PracticeSummary
					result={result}
					onHome={onHome}
					onRestart={vi.fn()}
					onPracticeIncorrect={onRetry}
					markdownRenderer={markdownRenderer}
				/>,
			);
			const primary = primaryButton();
			expect(primary.children).toBe(incorrectCount ? "practice.failed" : "practice.home");
			primary.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
			expect(incorrectCount ? onRetry : onHome).toHaveBeenCalledOnce();
		},
	);

	it.each([0, 1])("spelling prioritizes home or incorrect retry (%i incorrect)", (count) => {
		const onHome = vi.fn();
		const onRetry = vi.fn();
		const result = {
			originDeck: { name: "Deck" },
			totalWords: 4,
			firstTryCorrectCount: 4 - count,
			firstTryIncorrectCount: count,
			firstTryAccuracy: 75,
			totalRetrievalAttempts: 4,
			timeSpent: 5,
			incorrectCards: count
				? [{ identity: "a", back: "meaning", expectedAnswer: "word", firstInput: "wod" }]
				: [],
		} as unknown as SpellingResultSnapshot;
		renderToStaticMarkup(
			<SpellingSummary
				result={result}
				onHome={onHome}
				onRestart={vi.fn()}
				onRetryIncorrect={onRetry}
				markdownRenderer={markdownRenderer}
			/>,
		);
		const primary = primaryButton();
		expect(primary.children).toBe(count ? "spelling.retryIncorrect" : "practice.home");
		primary.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
		expect(count ? onRetry : onHome).toHaveBeenCalledOnce();
	});

	it("study prioritizes home and retains restart", () => {
		const onHome = vi.fn();
		const onRestart = vi.fn();
		const result = {
			originDeck: { name: "Deck" },
			cardCount: 3,
			totalReviews: 4,
			timeSpent: 5,
			ratingCounts: { 1: 1, 3: 3 },
		} as unknown as StudyResultSnapshot;
		renderToStaticMarkup(
			<StudySummary result={result} onHome={onHome} onRestart={onRestart} />,
		);
		expect(primaryButton().children).toBe("study.backHome");
		buttons
			.find((button) => button.children === "study.backToStudySetup")
			?.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
		expect(onRestart).toHaveBeenCalledOnce();
	});

	it.each([false, true])(
		"offers optional lapse practice and disables result actions while busy (%s)",
		(isBusy) => {
			const onPracticeLapses = vi.fn();
			const result = {
				originDeck: { name: "Deck" },
				cardCount: 1,
				totalReviews: 1,
				timeSpent: 3,
				ratingCounts: { 2: 1 },
				lapseCards: [
					{ identity: "a", front: "word", back: "meaning", sourceFile: "deck.md" },
				],
			} as unknown as StudyResultSnapshot;
			renderToStaticMarkup(
				<StudySummary
					result={result}
					onHome={vi.fn()}
					onRestart={vi.fn()}
					onPracticeLapses={onPracticeLapses}
					isBusy={isBusy}
				/>,
			);
			const practice = buttons.find((button) => button.children === "study.practiceLapses");
			expect(practice).toBeDefined();
			expect(practice?.disabled).toBe(isBusy);
			expect(primaryButton().disabled).toBe(isBusy);
			if (!isBusy) {
				practice?.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
				expect(onPracticeLapses).toHaveBeenCalledOnce();
			}
		},
	);

	it.each([
		[false, true],
		[true, false],
		[false, false],
	])(
		"challenge selects next level only when available (complete=%s, continue=%s)",
		(roundComplete, canContinue) => {
			const onNextLevel = vi.fn();
			const onEnd = vi.fn();
			const result = {
				roundComplete,
				canContinue,
				levelResult: {
					levelIndex: 0,
					firstTryAccuracy: 80,
					firstTryCorrectCount: 4,
					totalQuestions: 5,
					retryCount: 1,
					timeSpent: 5,
				},
				roundSummary: {
					completedLevels: 1,
					totalLevels: 2,
					firstTryCorrectCount: 4,
					totalQuestions: 5,
					retryCount: 1,
					timeSpent: 5,
				},
				removedCardCount: 0,
				incorrectCards: [],
			} as unknown as ChallengeResultSnapshot;
			renderToStaticMarkup(
				<ChallengeSummary
					result={result}
					onNextLevel={onNextLevel}
					onRestart={vi.fn()}
					onEnd={onEnd}
					markdownRenderer={markdownRenderer}
				/>,
			);
			const next = !roundComplete && canContinue;
			const primary = primaryButton();
			expect(primary.children).toBe(next ? "challenge.nextLevel" : "challenge.end");
			primary.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
			expect(next ? onNextLevel : onEnd).toHaveBeenCalledOnce();
		},
	);

	it("renders a review layout with lapse cards and note open actions in StudySummary", () => {
		const onHome = vi.fn();
		const onOpenSourceFile = vi.fn();
		const result = {
			originDeck: { name: "English 101" },
			cardCount: 2,
			totalReviews: 3,
			timeSpent: 12,
			ratingCounts: { 1: 1, 2: 1, 3: 0, 4: 0, 5: 0 },
			lapseCards: [
				{
					identity: "card-1",
					currentDeckId: "deck-1",
					front: "abandon",
					back: "v. 放弃",
					sourceFile: "notes/vocabulary.md",
					indexInFile: 0,
				},
			],
		} as unknown as StudyResultSnapshot;

		const html = renderToStaticMarkup(
			<StudySummary result={result} onHome={onHome} onOpenSourceFile={onOpenSourceFile} />,
		);

		expect(html).toContain("reviewContent");
		expect(html).toContain("inlineActions");
		expect(html).toContain("study.weakCardsTitle");
		expect(html).toContain("vocabulary.md");
	});

	it("renders all-mastered celebration state when there are no lapse cards", () => {
		const onHome = vi.fn();
		const result = {
			originDeck: { name: "English 101" },
			cardCount: 5,
			totalReviews: 5,
			timeSpent: 20,
			ratingCounts: { 1: 0, 2: 0, 3: 3, 4: 2, 5: 0 },
			lapseCards: [],
		} as unknown as StudyResultSnapshot;

		const html = renderToStaticMarkup(<StudySummary result={result} onHome={onHome} />);

		expect(html).toContain("reviewContent");
		expect(html).toContain("study.allMasteredTitle");
	});

	it("dispatches primary action on Enter / Space and onHome on Escape", () => {
		const onHome = vi.fn();
		const onRestart = vi.fn();
		const preventDefault = vi.fn();
		const options = {
			actions: [
				{ label: "Restart", onClick: onRestart },
				{ label: "Home", onClick: onHome, primary: true },
			],
			onHome,
		};

		// Enter
		expect(
			handleSessionSummaryKeyDown(
				{ key: "Enter", preventDefault, target: null },
				options,
				makeSummaryRoot(),
			),
		).toBe(true);
		expect(onHome).toHaveBeenCalledTimes(1);
		expect(preventDefault).toHaveBeenCalledTimes(1);

		// Space
		expect(
			handleSessionSummaryKeyDown(
				{ key: " ", preventDefault, target: null },
				options,
				makeSummaryRoot(),
			),
		).toBe(true);
		expect(onHome).toHaveBeenCalledTimes(2);

		// Escape
		expect(
			handleSessionSummaryKeyDown(
				{ key: "Escape", preventDefault, target: null },
				options,
				makeSummaryRoot(),
			),
		).toBe(true);
		expect(onHome).toHaveBeenCalledTimes(3);

		// Unhandled key
		expect(
			handleSessionSummaryKeyDown(
				{ key: "Tab", preventDefault, target: null },
				options,
				makeSummaryRoot(),
			),
		).toBe(false);

		// Ignored inside inputs
		const inputTarget = { tagName: "INPUT" } as unknown as HTMLElement;
		expect(
			handleSessionSummaryKeyDown(
				{ key: "Enter", preventDefault, target: inputTarget },
				options,
				makeSummaryRoot(),
			),
		).toBe(false);
		expect(onHome).toHaveBeenCalledTimes(3);
	});

	it.each(["BUTTON", "A", "SELECT", "SUMMARY"])(
		"leaves %s activation to the focused control",
		(tagName) => {
			const onHome = vi.fn();
			const preventDefault = vi.fn();
			const target = { tagName } as unknown as HTMLElement;
			const options = {
				actions: [{ label: "Home", onClick: onHome, primary: true }],
				onHome,
			};
			for (const key of ["Enter", " "]) {
				expect(
					handleSessionSummaryKeyDown(
						{ key, target, preventDefault },
						options,
						makeSummaryRoot(),
					),
				).toBe(false);
			}
			expect(onHome).not.toHaveBeenCalled();
			expect(preventDefault).not.toHaveBeenCalled();
		},
	);

	it("does not intercept descendants of a control or disabled primary actions", () => {
		const onHome = vi.fn();
		const options = {
			actions: [{ label: "Home", onClick: onHome, primary: true, disabled: true }],
			onHome,
		};
		const target = {
			tagName: "svg",
			closest: () => ({ tagName: "BUTTON" }),
		} as unknown as HTMLElement;
		expect(
			handleSessionSummaryKeyDown(
				{ key: "Enter", target, preventDefault: vi.fn() },
				options,
				makeSummaryRoot(),
			),
		).toBe(false);
		expect(
			handleSessionSummaryKeyDown(
				{ key: "Enter", target: null, preventDefault: vi.fn() },
				options,
				makeSummaryRoot(),
			),
		).toBe(false);
		expect(onHome).not.toHaveBeenCalled();
	});

	it("leaves keys from another pane, a modal, and repeated presses alone", () => {
		const onHome = vi.fn();
		const preventDefault = vi.fn();
		const options = { actions: [{ label: "Home", onClick: onHome, primary: true }], onHome };
		for (const key of ["Enter", " ", "Escape"]) {
			const event = { key, target: null, preventDefault };
			expect(handleSessionSummaryKeyDown(event, options, makeSummaryRoot(false))).toBe(false);
			expect(handleSessionSummaryKeyDown(event, options, makeSummaryRoot(true, true))).toBe(
				false,
			);
			expect(
				handleSessionSummaryKeyDown({ ...event, repeat: true }, options, makeSummaryRoot()),
			).toBe(false);
		}
		expect(preventDefault).not.toHaveBeenCalled();
		expect(onHome).not.toHaveBeenCalled();
	});

	it("takes initial focus only while its own document has unclaimed focus", () => {
		const root = makeSummaryRoot();
		const focus = vi.fn();
		root.focus = focus;
		focusSessionSummary(root);
		expect(focus).toHaveBeenCalledWith({ preventScroll: true });
		focus.mockClear();
		const modalRoot = makeSummaryRoot(true, true);
		modalRoot.focus = focus;
		focusSessionSummary(modalRoot);
		expect(focus).not.toHaveBeenCalled();
	});
});
