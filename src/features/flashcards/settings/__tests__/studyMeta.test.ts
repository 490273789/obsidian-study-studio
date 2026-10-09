import { describe, expect, it } from "vite-plus/test";
import {
	STUDY_SETTINGS_LIMITS,
	STUDY_ORDER_OPTIONS,
	calculateEstimatedDays,
	calculateDailyNewCardsFromDays,
	clampDailyNewCards,
	clampDailyReviewCards,
	clampRequestRetention,
	clampMaximumInterval,
	parseMaximumInterval,
	parseStudyOrder,
} from "../studyMeta";

describe("studySettingsMeta", () => {
	describe("STUDY_SETTINGS_LIMITS and options", () => {
		it("provides expected bounds and options", () => {
			expect(STUDY_SETTINGS_LIMITS.dailyNewCards).toEqual({
				min: 1,
				max: 200,
				step: 1,
				default: 20,
			});
			expect(STUDY_SETTINGS_LIMITS.dailyReviewCards).toEqual({
				min: 1,
				max: 500,
				step: 10,
				default: 50,
			});
			expect(STUDY_SETTINGS_LIMITS.requestRetention).toEqual({
				min: 0.7,
				max: 0.99,
				step: 0.01,
				default: 0.9,
			});
			expect(STUDY_SETTINGS_LIMITS.maximumInterval).toEqual({
				min: 30,
				max: 3650,
				step: 1,
				default: 365,
			});
			expect(STUDY_ORDER_OPTIONS).toEqual(["sequential", "random"]);
		});
	});

	describe("calculateEstimatedDays", () => {
		it("returns 0 when total cards is 0 or negative", () => {
			expect(calculateEstimatedDays(0, 20)).toBe(0);
			expect(calculateEstimatedDays(-5, 20)).toBe(0);
		});

		it("returns 0 when daily new cards is 0 or negative", () => {
			expect(calculateEstimatedDays(100, 0)).toBe(0);
			expect(calculateEstimatedDays(100, -10)).toBe(0);
		});

		it("calculates ceiling days accurately", () => {
			expect(calculateEstimatedDays(100, 20)).toBe(5);
			expect(calculateEstimatedDays(101, 20)).toBe(6);
			expect(calculateEstimatedDays(1, 20)).toBe(1);
		});
	});

	describe("calculateDailyNewCardsFromDays", () => {
		it("returns min (1) when days is invalid or cards is 0", () => {
			expect(calculateDailyNewCardsFromDays(100, 0)).toBe(1);
			expect(calculateDailyNewCardsFromDays(100, -2)).toBe(1);
			expect(calculateDailyNewCardsFromDays(100, Number.NaN)).toBe(1);
			expect(calculateDailyNewCardsFromDays(0, 10)).toBe(1);
		});

		it("calculates daily new cards ceiling", () => {
			expect(calculateDailyNewCardsFromDays(100, 10)).toBe(10);
			expect(calculateDailyNewCardsFromDays(101, 10)).toBe(11);
		});

		it("clamps result to [1, 200]", () => {
			expect(calculateDailyNewCardsFromDays(1000, 1)).toBe(200);
			expect(calculateDailyNewCardsFromDays(1, 100)).toBe(1);
		});
	});

	describe("clamping helpers", () => {
		it("clamps daily new cards", () => {
			expect(clampDailyNewCards(10)).toBe(10);
			expect(clampDailyNewCards(0)).toBe(1);
			expect(clampDailyNewCards(300)).toBe(200);
			expect(clampDailyNewCards(15.6)).toBe(16);
			expect(clampDailyNewCards(Number.NaN)).toBe(20);
		});

		it("clamps daily review cards", () => {
			expect(clampDailyReviewCards(50)).toBe(50);
			expect(clampDailyReviewCards(0)).toBe(1);
			expect(clampDailyReviewCards(600)).toBe(500);
			expect(clampDailyReviewCards(Number.NaN)).toBe(50);
		});

		it("clamps request retention", () => {
			expect(clampRequestRetention(0.85)).toBe(0.85);
			expect(clampRequestRetention(0.5)).toBe(0.7);
			expect(clampRequestRetention(1.2)).toBe(0.99);
			expect(clampRequestRetention(Number.NaN)).toBe(0.9);
		});

		it("clamps maximum interval", () => {
			expect(clampMaximumInterval(180)).toBe(180);
			expect(clampMaximumInterval(10, 365)).toBe(365);
			expect(clampMaximumInterval(5000)).toBe(3650);
			expect(clampMaximumInterval(Number.NaN, 365)).toBe(365);
		});

		it("parses maximum interval string", () => {
			expect(parseMaximumInterval("180")).toBe(180);
			expect(parseMaximumInterval("20", 365)).toBe(365);
			expect(parseMaximumInterval("invalid", 365)).toBe(365);
			expect(parseMaximumInterval("4000")).toBe(3650);
		});

		it("parses study order", () => {
			expect(parseStudyOrder("random")).toBe("random");
			expect(parseStudyOrder("sequential")).toBe("sequential");
			expect(parseStudyOrder("unknown")).toBe("sequential");
			expect(parseStudyOrder(null)).toBe("sequential");
		});
	});
});
