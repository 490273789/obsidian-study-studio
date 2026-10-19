import { createEmptyCard } from "ts-fsrs";
import { describe, expect, it, vi } from "vite-plus/test";
import type { SerializedFSRSCard } from "../persistenceTypes";
import type { SessionWriteSet } from "../sessionCommitFormat";
import { SessionJournalCoordinator } from "../sessionJournalCoordinator";
import type { SessionJournalEntry, SessionJournalStore } from "../sessionJournal";

function serializedFsrsCard(): SerializedFSRSCard {
	return {
		due: "2026-10-13T00:00:00.000Z",
		stability: 1,
		difficulty: 1,
		elapsed_days: 0,
		scheduled_days: 1,
		reps: 1,
		lapses: 0,
		state: 2,
		last_review: null,
		learning_steps: 0,
	};
}

function transition(): SessionWriteSet {
	return {
		cardUpdates: [
			{ deckId: "deck", cardId: "a", fsrsCard: createEmptyCard() },
			{ deckId: "deck", cardId: "b", fsrsCard: createEmptyCard() },
		],
		spellingAttempts: [{ cardId: "a", correct: true, attemptedAt: 5 }],
		incrementStudyCountFor: [],
		historyEntries: [],
	};
}

function fixture(options: { flushThreshold?: number } = {}) {
	const file: SessionJournalEntry[] = [];
	const calls: string[] = [];
	const applied: { entries: SessionJournalEntry[]; includeSpelling: boolean }[] = [];
	const merges: number[] = [];
	const journal = {
		load: vi.fn(async () => [...file]),
		append: vi.fn(async (entries: readonly SessionJournalEntry[]) => {
			calls.push("journal:append");
			file.push(...entries);
		}),
		clear: vi.fn(async () => {
			calls.push("journal:clear");
			file.length = 0;
		}),
	} satisfies SessionJournalStore;
	let failMerge = false;
	let timerCallback: (() => void) | null = null;
	const timer = {
		setTimeout: vi.fn((callback: () => void) => {
			timerCallback = callback;
			return 1;
		}),
		clearTimeout: vi.fn(),
	};
	const requestMerge = vi.fn();
	const coordinator = new SessionJournalCoordinator({
		merge: async (watermark) => {
			if (failMerge) throw new Error("merge failed");
			calls.push(`merge:${watermark}`);
			merges.push(watermark);
		},
		apply: (entries, includeSpelling) => {
			calls.push("apply");
			applied.push({ entries: [...entries], includeSpelling });
		},
		serializeFsrsCard: () => serializedFsrsCard(),
		requestMerge,
		journal,
		flushThreshold: options.flushThreshold,
		idleFlushMilliseconds: 1_000,
		timer,
	});
	return {
		coordinator,
		journal,
		file,
		calls,
		applied,
		merges,
		requestMerge,
		timer,
		setFailMerge: (value: boolean) => {
			failMerge = value;
		},
		fireTimer: () => timerCallback?.(),
	};
}

describe("SessionJournalCoordinator", () => {
	it("makes the append durable before installing the entries in memory", async () => {
		const f = fixture();

		const result = await f.coordinator.append(transition());

		expect(result.kind).toBe("appended");
		expect(f.calls).toEqual(["journal:append", "apply"]);
		expect(f.file.map((entry) => entry.seq)).toEqual([1, 2, 3]);
		expect(f.coordinator.watermark).toBe(0);
		expect(f.coordinator.lastWritten).toBe(3);
		expect(f.coordinator.pendingCount).toBe(3);
		expect(f.coordinator.hasUnmerged()).toBe(true);
	});

	it("merges entries above the watermark and adopts the highest written sequence", async () => {
		const f = fixture();
		await f.coordinator.append(transition());

		await f.coordinator.mergeNow();

		expect(f.merges).toEqual([3]);
		expect(f.coordinator.watermark).toBe(3);
		expect(f.coordinator.pendingCount).toBe(0);
		expect(f.coordinator.hasUnmerged()).toBe(false);
		expect(f.journal.clear).toHaveBeenCalledOnce();

		await f.coordinator.mergeNow();
		expect(f.merges).toEqual([3]);
	});

	it("drops journal lines already merged when replaying after a restore", async () => {
		const f = fixture();
		f.file.push(
			{
				seq: 1,
				at: 1,
				kind: "card-update",
				cardUpdate: { deckId: "deck", cardId: "a", fsrsCard: serializedFsrsCard() },
			},
			{
				seq: 2,
				at: 2,
				kind: "card-update",
				cardUpdate: { deckId: "deck", cardId: "b", fsrsCard: serializedFsrsCard() },
			},
		);
		f.coordinator.reset(1);

		await f.coordinator.replay();

		expect(f.applied).toHaveLength(1);
		expect(f.applied[0]!.entries.map((entry) => entry.seq)).toEqual([2]);
		expect(f.coordinator.pendingCount).toBe(1);
		expect(f.coordinator.watermark).toBe(1);

		f.coordinator.reset(2);
		await f.coordinator.replay();

		expect(f.journal.clear).toHaveBeenCalled();
		expect(f.coordinator.pendingCount).toBe(0);
	});

	it("keeps pending state when a merge fails so it can be retried", async () => {
		const f = fixture();
		await f.coordinator.append(transition());
		f.setFailMerge(true);

		expect(await f.coordinator.tryMerge()).toBe(false);
		expect(f.coordinator.pendingCount).toBe(3);
		expect(f.coordinator.watermark).toBe(0);
		expect(f.coordinator.hasUnmerged()).toBe(true);

		f.setFailMerge(false);
		expect(await f.coordinator.tryMerge()).toBe(true);
		expect(f.coordinator.pendingCount).toBe(0);
		expect(f.coordinator.watermark).toBe(3);
	});

	it("settles a dirty journal file before allocating new sequences", async () => {
		const f = fixture();
		f.journal.load.mockRejectedValueOnce(new Error("unreadable journal"));
		await f.coordinator.replay();
		expect(f.coordinator.hasUnmerged()).toBe(true);
		expect(f.coordinator.pendingCount).toBe(0);

		const result = await f.coordinator.append(transition());

		expect(result.kind).toBe("appended");
		expect(f.calls).toEqual(["journal:clear", "journal:append", "apply"]);
		expect(f.file.map((entry) => entry.seq)).toEqual([1, 2, 3]);
	});

	it("requests an idle merge through the injected timer", async () => {
		const f = fixture();
		await f.coordinator.append(transition());

		expect(f.timer.setTimeout).toHaveBeenCalledOnce();
		f.fireTimer();

		expect(f.requestMerge).toHaveBeenCalledOnce();
	});

	it("reports a threshold reached only after enough pending entries", async () => {
		const f = fixture({ flushThreshold: 2 });
		await f.coordinator.append(transition());

		expect(f.coordinator.reachedFlushThreshold()).toBe(true);
	});
});
