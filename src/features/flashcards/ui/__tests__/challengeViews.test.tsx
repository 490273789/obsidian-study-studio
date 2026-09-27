import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../../core/ui/context/I18nContext";
import { flashcardTranslator } from "../../strings";
import { ChallengeView } from "../views/Challenge/ChallengeView";
import { ChallengeSetupModal } from "../views/Challenge/ChallengeSetupModal";
import type { ActiveChallengeSnapshot } from "../../domain/sessions/sessionLifecycle";
import type { AnswerPresentationTransition } from "../answerPresentationTransition";

vi.mock("obsidian", () => ({ Notice: vi.fn(), Component: class {} }));
vi.mock("../primitives/Markdown", () => ({
	MarkdownContent: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock("../../../../core/ui/primitives/Modal", () => ({
	ModalSurface: ({
		children,
		onRequestClose,
	}: {
		children: (controls: {
			requestClose: () => void;
			initialFocusProps: object;
		}) => React.ReactNode;
		onRequestClose: () => void;
	}) => <div>{children({ requestClose: onRequestClose, initialFocusProps: {} })}</div>,
}));

function render(child: React.ReactNode) {
	return renderToStaticMarkup(
		<I18nProvider language="zh" translator={flashcardTranslator}>
			{child}
		</I18nProvider>,
	);
}
function session(questionMode: ActiveChallengeSnapshot["questionMode"]): ActiveChallengeSnapshot {
	return {
		kind: "active",
		mode: "challenge",
		revision: 1,
		reference: { kind: "active", mode: "challenge", revision: 1, key: "challenge" },
		startTime: 0,
		currentCard: {
			identity: "one",
			currentDeckId: "deck",
			sourceFile: "deck.md",
			indexInFile: 0,
			front: "secret-word",
			back: "中文释义",
			explanation: "答案详解",
		},
		sourceDeck: { id: "deck", name: "词组来源" },
		questionMode,
		phase: "question",
		feedback: null,
		progress: { current: 1, completed: 0, total: 15, percent: 0, label: "0/15" },
		roundProgress: {
			level: 1,
			totalLevels: 2,
			passedInLevel: 0,
			currentLevelTotal: 15,
			completedAcrossRound: 0,
			totalAcrossRound: 20,
		},
		answerEventCount: 0,
		removedCardCount: 0,
	};
}
const common = {
	transition: { act: vi.fn() } as unknown as AnswerPresentationTransition,
	isTransitioning: false,
	onClose: vi.fn(),
	markdownRenderer: async () => {},
};

describe("challenge views", () => {
	it.each(["spelling", "reversed"] as const)(
		"does not leak the word or explanation before answering %s",
		(mode) => {
			const html = render(<ChallengeView {...common} session={session(mode)} />);
			expect(html).toContain("中文释义");
			expect(html).not.toContain("secret-word");
			expect(html).not.toContain("答案详解");
			expect(html).toContain("词组来源");
		},
	);
	it("shows the correct word in spelling feedback and offers continue", () => {
		const html = render(
			<ChallengeView
				{...common}
				session={{
					...session("spelling"),
					phase: "feedback",
					feedback: { correct: false, expectedAnswer: "secret-word" },
				}}
			/>,
		);
		expect(html).toContain("secret-word");
		expect(html).toContain("继续答题");
		expect(html).not.toContain('type="text"');
	});
	it("keeps forward answers hidden until reveal", () => {
		const html = render(<ChallengeView {...common} session={session("normal")} />);
		expect(html).toContain("secret-word");
		expect(html).not.toContain("中文释义");
	});
	it("offers only a new challenge when selected settings differ from saved settings", () => {
		const html = render(
			<ChallengeSetupModal
				readiness={{
					eligibleCount: 20,
					lastMode: "spelling",
					round: {
						id: "round",
						mode: "normal",
						completedLevelCount: 1,
						totalLevels: 2,
						completedCardCount: 15,
						totalCards: 20,
					},
				}}
				isStarting={false}
				onStart={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		expect(html).toContain("开始新挑战");
		expect(html).not.toContain(">继续挑战<");
	});
	it("offers resume and restart for unchanged settings", () => {
		const html = render(
			<ChallengeSetupModal
				readiness={{
					eligibleCount: 20,
					lastMode: "normal",
					round: {
						id: "round",
						mode: "normal",
						completedLevelCount: 1,
						totalLevels: 2,
						completedCardCount: 15,
						totalCards: 20,
					},
				}}
				isStarting={false}
				onStart={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		expect(html).toContain("继续挑战");
		expect(html).toContain("重新挑战");
		expect(html).toContain("15/20");
	});
	it("explains empty eligibility and disables starting", () => {
		const html = render(
			<ChallengeSetupModal
				readiness={{ eligibleCount: 0, lastMode: "random", round: null }}
				isStarting={false}
				onStart={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		expect(html).toContain("还没有可挑战");
		expect(html).toMatch(/<button[^>]*disabled=""[^>]*>开始挑战/);
	});
});
