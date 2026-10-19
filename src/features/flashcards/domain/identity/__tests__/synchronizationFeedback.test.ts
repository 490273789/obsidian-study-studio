import { describe, expect, it } from "vite-plus/test";
import type { CardIdentityContinuitySnapshot, SynchronizeOutcome } from "../cardIdentityContinuity";
import {
	describeCardChangeOutcome,
	describeSynchronizationOutcome,
} from "../synchronizationFeedback";

const CONFLICT_ID = "73688849-a7f8-4b7c-9f46-4a3d75d7b5c5";

describe("synchronization feedback", () => {
	it("explains the first identity conflict with its source, card, and repair action", () => {
		const outcome: SynchronizeOutcome = {
			kind: "attention-required",
			change: { changedDeckIds: [], removedDeckIds: [], tagsChanged: false },
			issueIds: [`identity-conflict:${CONFLICT_ID}`, "identity-conflict:another"],
		};
		const snapshot: CardIdentityContinuitySnapshot = {
			sources: {
				"Word/SeniorHeighSchool.md": {
					type: "last-known-good",
					reason: "identity-conflict",
				},
			},
			issues: [
				{
					id: `identity-conflict:${CONFLICT_ID}`,
					ticket: "identity-conflict:ticket",
					type: "identity-conflict",
					identity: CONFLICT_ID,
					affectedSources: ["Word/SeniorHeighSchool.md"],
					candidates: [
						{
							token: "candidate-1",
							sourcePath: "Word/SeniorHeighSchool.md",
							front: "## gap",
							back: "n. 间隔",
						},
						{
							token: "candidate-2",
							sourcePath: "Word/SeniorHeighSchool.md",
							front: "## gap",
							back: "n. 间隔",
						},
					],
				},
			],
			journal: null,
		};

		const message = describeSynchronizationOutcome(outcome, snapshot, "zh");

		expect(message).toContain("题库导入未完成");
		expect(message).toContain("Word/SeniorHeighSchool.md");
		expect(message).toContain(CONFLICT_ID);
		expect(message).toContain("gap");
		expect(message).toContain("修复卡片身份冲突");
		expect(message).toContain("另有 1 个身份问题");
	});

	it("explains identity ambiguity in English", () => {
		const outcome: SynchronizeOutcome = {
			kind: "attention-required",
			change: { changedDeckIds: [], removedDeckIds: [], tagsChanged: false },
			issueIds: ["identity-ambiguity:Word/test.md"],
		};
		const snapshot: CardIdentityContinuitySnapshot = {
			sources: {},
			issues: [
				{
					id: "identity-ambiguity:Word/test.md",
					ticket: "identity-ambiguity:ticket",
					type: "identity-ambiguity",
					missingIdentities: ["old-1", "old-2"],
					affectedSources: ["Word/test.md"],
					candidates: [],
				},
			],
			journal: null,
		};

		expect(describeSynchronizationOutcome(outcome, snapshot, "en")).toBe(
			"Deck import incomplete: 2 card identities in Word/test.md could not be matched. Run “Repair card identity conflicts” and refresh again.",
		);
	});

	it("returns the underlying failure and stays silent for a current sync", () => {
		const snapshot: CardIdentityContinuitySnapshot = {
			sources: {},
			issues: [],
			journal: null,
		};

		expect(
			describeSynchronizationOutcome(
				{ kind: "failed", retryable: true, message: "Source changed" },
				snapshot,
				"zh",
			),
		).toBe("题库同步失败：Source changed");
		expect(
			describeSynchronizationOutcome(
				{
					kind: "current",
					change: { changedDeckIds: [], removedDeckIds: [], tagsChanged: false },
				},
				snapshot,
				"zh",
			),
		).toBeNull();
	});

	describe("card change feedback", () => {
		it("translates blocked outcomes correctly in Chinese and English", () => {
			expect(
				describeCardChangeOutcome({ kind: "blocked", reason: "migration-required" }, "zh"),
			).toBe("请先迁移该题库的卡片身份，再编辑卡片");

			expect(
				describeCardChangeOutcome({ kind: "blocked", reason: "migration-required" }, "en"),
			).toBe("Migrate this deck's card identities before editing cards");

			expect(
				describeCardChangeOutcome({ kind: "blocked", reason: "source-needs-repair" }, "zh"),
			).toBe("请先修复该题库的卡片身份问题，再编辑卡片");

			expect(
				describeCardChangeOutcome({ kind: "blocked", reason: "source-needs-repair" }, "en"),
			).toBe("Repair this deck's card identity issue before editing cards");
		});

		it("translates validation errors correctly", () => {
			expect(
				describeCardChangeOutcome(
					{ kind: "validation-failed", error: { type: "missing-front" } },
					"zh",
				),
			).toBe("正面不能为空");

			expect(
				describeCardChangeOutcome(
					{ kind: "validation-failed", error: { type: "missing-back" } },
					"zh",
				),
			).toBe("背面不能为空");

			expect(
				describeCardChangeOutcome(
					{
						kind: "validation-failed",
						error: { type: "reserved-marker", marker: "??" },
					},
					"zh",
				),
			).toBe("内容中不能单独一行使用 ??、:: 或 ;;，这些是卡片结构标记");

			expect(
				describeCardChangeOutcome(
					{ kind: "validation-failed", error: { type: "card-not-found" } },
					"zh",
				),
			).toBe("题目不存在");
		});

		it("translates source-changing and generic failure", () => {
			expect(
				describeCardChangeOutcome({ kind: "source-changing", deckId: "deck.md" }, "zh"),
			).toBe("源文档正在变化，请刷新后重试");

			expect(
				describeCardChangeOutcome(
					{ kind: "failed", retryable: false, message: "Custom error message" },
					"zh",
				),
			).toBe("Custom error message");
		});
	});
});
