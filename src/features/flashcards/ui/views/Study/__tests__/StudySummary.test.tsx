import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { I18nProvider } from "../../../../../../core/ui/context/I18nContext";
import type { Language } from "../../../../../../core/shared/types";
import type { StudyResultSnapshot } from "../../../../domain/sessions/sessionLifecycle";
import { flashcardTranslator } from "../../../../strings";
import { StudySummary } from "../StudySummary";

vi.mock("../../../../../../core/ui/primitives/Header", () => ({
	FlashcardHeader: () => <header />,
}));
vi.mock("../../../../../../core/ui/primitives/Confetti", () => ({ Confetti: () => null }));
vi.mock("../../../primitives/Markdown/MarkdownContent", () => ({ MarkdownContent: () => <div /> }));

function summary(overrides: Partial<StudyResultSnapshot> = {}, language: Language = "zh") {
	const result = {
		originDeck: { name: "English" },
		cardCount: 51,
		totalReviews: 57,
		timeSpent: 703,
		ratingCounts: { 1: 6, 2: 5, 3: 34, 4: 11, 5: 1 },
		lapseCards: Array.from({ length: 7 }, (_, index) => ({
			identity: `card-${index}`,
			front: `word-${index}`,
			back: "释义",
			sourceFile: "English.md",
		})),
		...overrides,
	} as StudyResultSnapshot;
	return renderToStaticMarkup(
		<I18nProvider language={language} translator={flashcardTranslator}>
			<StudySummary result={result} onHome={vi.fn()} onRestart={vi.fn()} />
		</I18nProvider>,
	);
}

describe("study result statistics", () => {
	it("distinguishes unique cards from repeated answers in the completion copy", () => {
		const html = summary();
		expect(html).toContain("回答 57 次（含 6 次重复回答）");
		expect(html).toContain("评级统计 · 57 次回答");
		expect(html).toContain("未评为忘记或困难");
		expect(html).toContain("44/51 张（86%）");
		expect(html).toContain("11分43秒");
		expect(html).toContain("12.3秒/次回答");
		expect(html).toContain("返回学习设置");
		expect(html).not.toContain("本次掌握率");
	});

	it("describes an all-good session without claiming long-term mastery", () => {
		const html = summary({ cardCount: 5, totalReviews: 5, timeSpent: 20, lapseCards: [] });
		expect(html).toContain("English · 回答 5 次");
		expect(html).not.toContain("重复回答");
		expect(html).toContain("5/5 张（100%）");
		expect(html).toContain("本轮没有卡片被评为忘记或困难。");
		expect(html).not.toContain("全部掌握");
	});

	it("keeps zero-answer statistics finite", () => {
		const html = summary({ cardCount: 0, totalReviews: 0, timeSpent: 0, lapseCards: [] });
		expect(html).toContain("0/0 张（0%）");
		expect(html).toContain("0.0秒/次回答");
		expect(html).not.toMatch(/NaN|Infinity/);
	});

	it("uses answer units and explicit recall criteria in English too", () => {
		const html = summary({}, "en");
		expect(html).toContain("57 answers (6 repeated answers)");
		expect(html).toContain("Not rated Again or Hard");
		expect(html).toContain("44/51 cards (86%)");
		expect(html).toContain("12.3s/answer");
		expect(html).toContain("Back to study setup");
	});
});
