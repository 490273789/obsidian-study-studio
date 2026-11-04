import type { DeckStats, StudySettings } from "../../../../core/shared/types";

/** Apply daily limits to the deck's new-card and due-review inventory. */
export function getStudyPlanSummary(
	stats: Pick<DeckStats, "newCards" | "dueCards">,
	settings: Pick<StudySettings, "dailyNewCards" | "dailyReviewCards">,
) {
	const todayNewCount = Math.min(Math.max(0, settings.dailyNewCards), stats.newCards);
	const todayReviewCount = Math.min(Math.max(0, settings.dailyReviewCards), stats.dueCards);
	return { todayNewCount, todayReviewCount, todayTotal: todayNewCount + todayReviewCount };
}
