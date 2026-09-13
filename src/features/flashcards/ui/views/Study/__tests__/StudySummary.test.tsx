import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StudyResultSnapshot } from "../../../../domain/sessions/sessionLifecycle";
import { flashcardTranslator } from "../../../../strings/index";
import { I18nProvider } from "../../../../../../core/ui/context/I18nContext";
import { StudySummary } from "../StudySummary";

function makeStudyResult(overrides: Partial<StudyResultSnapshot> = {}): StudyResultSnapshot {
	return {
		kind: "result",
		mode: "study",
		revision: 1,
		reference: {
			kind: "result",
			mode: "study",
			revision: 1,
			key: "study-result-1",
		},
		originDeck: {
			id: "notes/deck.md",
			name: "CET-4 核心词汇",
		},
		completedAt: 100_000,
		cardCount: 15,
		totalReviews: 18,
		timeSpent: 125, // 2m 5s
		ratingCounts: {
			1: 2,
			2: 3,
			3: 8,
			4: 4,
			5: 1,
		},
		setupDefaults: {
			mode: "study",
			deckId: "notes/deck.md",
			studyOrder: "sequential",
			direction: "normal",
		},
		...overrides,
	};
}

function renderSummary(result: StudyResultSnapshot, language: "zh" | "en" = "zh") {
	const onHome = vi.fn();
	const onRestart = vi.fn();
	const html = renderToStaticMarkup(
		<I18nProvider language={language} translator={flashcardTranslator}>
			<StudySummary result={result} onHome={onHome} onRestart={onRestart} />
		</I18nProvider>,
	);
	return { html, onHome, onRestart };
}

describe("StudySummary", () => {
	it("renders the study complete title and deck summary in Chinese", () => {
		const result = makeStudyResult();
		const { html } = renderSummary(result, "zh");

		expect(html).toContain("学习完成！");
		expect(html).toContain("CET-4 核心词汇");
		expect(html).toContain("15");
		expect(html).toContain("18");
		expect(html).toContain("回到首页");
		expect(html).toContain("再学一组");
	});

	it("renders the key metric cards: cards learned, total reviews, and formatted time", () => {
		const result = makeStudyResult();
		const { html } = renderSummary(result, "zh");

		expect(html).toContain("学习卡片");
		expect(html).toContain("复习次数");
		expect(html).toContain("学习耗时");
		expect(html).toContain("15");
		expect(html).toContain("18");
	});

	it("renders the 5 rating breakdown items with counts and labels", () => {
		const result = makeStudyResult();
		const { html } = renderSummary(result, "zh");

		expect(html).toContain("评级统计");
		expect(html).toContain("忘记");
		expect(html).toContain("困难");
		expect(html).toContain("记得");
		expect(html).toContain("轻松");
		expect(html).toContain("熟练");
	});

	it("renders in English correctly", () => {
		const result = makeStudyResult();
		const { html } = renderSummary(result, "en");

		expect(html).toContain("Study Complete!");
		expect(html).toContain("Back to Home");
		expect(html).toContain("Study Again");
		expect(html).toContain("Cards Learned");
		expect(html).toContain("Total Reviews");
		expect(html).toContain("Time Spent");
		expect(html).toContain("Rating Breakdown");
	});

	it("renders single count summary when totalReviews equals cardCount", () => {
		const result = makeStudyResult({ cardCount: 10, totalReviews: 10 });
		const { html } = renderSummary(result, "zh");

		expect(html).toContain("共学习 10 张卡片");
	});
});
