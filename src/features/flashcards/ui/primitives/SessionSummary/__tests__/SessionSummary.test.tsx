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
vi.mock("../../../../strings/context", () => ({
	useFlashcardI18n: () => ({ language: "zh", t: (key: string) => key }),
}));

function primaryButton() {
	const primary = buttons.filter((button) => button.variant === "primary");
	expect(primary).toHaveLength(1);
	return primary[0]!;
}

const markdownRenderer = async () => {};

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
			.find((button) => button.children === "study.studyAgain")
			?.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
		expect(onRestart).toHaveBeenCalledOnce();
	});

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
});
