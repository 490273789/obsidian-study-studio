import { describe, expect, it, vi } from "vite-plus/test";
import { applySourceEditTransaction } from "../sourceEditTransaction";

function fixture(replaceResult: "written" | "stale" = "written") {
	const replaceIfUnchanged = vi.fn().mockResolvedValue(replaceResult);
	const synchronize = vi.fn().mockResolvedValue({
		kind: "current",
		change: { changedDeckIds: [], removedDeckIds: [], tagsChanged: false },
	});
	const sourceStore = {
		list: vi.fn(),
		replaceIfUnchanged,
	};
	return { replaceIfUnchanged, synchronize, sourceStore };
}

describe("source edit transaction", () => {
	it("writes through fresh-content checking and keeps the edited path authoritative", async () => {
		const f = fixture();
		const result = await applySourceEditTransaction({
			path: "words.md",
			expectedContent: "old",
			nextContent: "new",
			sourceStore: f.sourceStore,
			synchronize: f.synchronize,
		});

		expect(result).toEqual({ kind: "applied" });
		expect(f.replaceIfUnchanged).toHaveBeenCalledWith("words.md", "old", "new");
		expect(f.synchronize).toHaveBeenCalledWith("words.md");
	});

	it("skips the write when the next content is unchanged but still synchronizes", async () => {
		const f = fixture();
		const result = await applySourceEditTransaction({
			path: "words.md",
			expectedContent: "same",
			nextContent: "same",
			sourceStore: f.sourceStore,
			synchronize: f.synchronize,
		});

		expect(result).toEqual({ kind: "applied" });
		expect(f.replaceIfUnchanged).not.toHaveBeenCalled();
		expect(f.synchronize).toHaveBeenCalledOnce();
	});

	it("reports a stale write without synchronizing", async () => {
		const f = fixture("stale");
		const result = await applySourceEditTransaction({
			path: "words.md",
			expectedContent: "old",
			nextContent: "new",
			sourceStore: f.sourceStore,
			synchronize: f.synchronize,
		});

		expect(result).toEqual({ kind: "source-changing" });
		expect(f.synchronize).not.toHaveBeenCalled();
	});

	it("maps synchronization failure and thrown write failures to failed outcomes", async () => {
		const f = fixture();
		f.synchronize.mockResolvedValueOnce({ kind: "failed", retryable: true, message: "sync" });
		expect(
			await applySourceEditTransaction({
				path: "words.md",
				expectedContent: "old",
				nextContent: "new",
				sourceStore: f.sourceStore,
				synchronize: f.synchronize,
			}),
		).toEqual({ kind: "failed", retryable: true, message: "sync" });

		const throwing = fixture();
		throwing.replaceIfUnchanged.mockRejectedValueOnce(new Error("disk"));
		expect(
			await applySourceEditTransaction({
				path: "words.md",
				expectedContent: "old",
				nextContent: "new",
				sourceStore: throwing.sourceStore,
				synchronize: throwing.synchronize,
			}),
		).toEqual({ kind: "failed", retryable: false, message: "disk" });
	});
});
