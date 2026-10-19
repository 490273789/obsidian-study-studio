import type { Card } from "ts-fsrs";
import type { SerializedFSRSCard } from "./persistenceTypes";
import type { SessionWriteSet } from "./sessionCommitFormat";
import type {
	SessionJournalEntry,
	SessionJournalStore,
	SessionJournalTimer,
} from "./sessionJournal";

const DEFAULT_FLUSH_THRESHOLD = 128;
const DEFAULT_IDLE_FLUSH_MILLISECONDS = 3_000;

/** Side of the coordinator that only the repository can provide. */
export interface SessionJournalMergeHost {
	/** Build and durably commit the learning document that records `watermark`. */
	merge(watermark: number): Promise<void>;
	/** Apply entries to in-memory decks and spelling progress. */
	apply(entries: readonly SessionJournalEntry[], includeSpellingAttempts: boolean): void;
	/** Serialize one FSRS card for a new journal entry. */
	serializeFsrsCard(card: Card): SerializedFSRSCard;
	/** Enqueue a merge requested by the idle timer. */
	requestMerge(): void;
}

export interface SessionJournalCoordinatorOptions extends SessionJournalMergeHost {
	journal: SessionJournalStore | null;
	flushThreshold?: number;
	idleFlushMilliseconds?: number;
	timer: SessionJournalTimer;
}

export type SessionJournalAppendResult =
	| { readonly kind: "appended" }
	| { readonly kind: "unavailable" }
	/** Settling the on-disk journal before allocating new sequences failed. */
	| { readonly kind: "settle-failed"; readonly error: unknown }
	/** The append itself failed; durability must fall back to a full document commit. */
	| { readonly kind: "append-failed"; readonly error: unknown };

/**
 * Owns the local per-answer journal: sequence watermarks, pending entries, the
 * file-dirty flag, and the idle merge timer. The repository only reports how to
 * build/commit a merged document and how to apply entries in memory.
 *
 * Durability invariants stay here: an append is durable before it is reported;
 * a merge commits the document before the journal is truncated; a failed merge
 * keeps both the journal and pending state so it can be retried.
 */
export class SessionJournalCoordinator {
	private watermarkSeq = 0;
	private lastWrittenSeq = 0;
	private pending: SessionJournalEntry[] = [];
	private fileDirty = false;
	private idleTimer: unknown = null;
	private disposed = false;
	private readonly host: SessionJournalMergeHost;
	private readonly journal: SessionJournalStore | null;
	private readonly flushThreshold: number;
	private readonly idleFlushMilliseconds: number;
	private readonly timer: SessionJournalTimer;

	constructor(options: SessionJournalCoordinatorOptions) {
		this.host = options;
		this.journal = options.journal;
		this.flushThreshold = Math.max(
			1,
			Math.floor(options.flushThreshold ?? DEFAULT_FLUSH_THRESHOLD),
		);
		this.idleFlushMilliseconds = Math.max(
			0,
			options.idleFlushMilliseconds ?? DEFAULT_IDLE_FLUSH_MILLISECONDS,
		);
		this.timer = options.timer;
	}

	get hasStore(): boolean {
		return this.journal !== null;
	}

	/** Highest sequence already merged into the persisted learning document. */
	get watermark(): number {
		return this.watermarkSeq;
	}

	/** Highest sequence this process has written (pending included). */
	get lastWritten(): number {
		return this.lastWrittenSeq;
	}

	get pendingCount(): number {
		return this.pending.length;
	}

	hasUnmerged(): boolean {
		return this.pending.length > 0 || this.fileDirty;
	}

	reachedFlushThreshold(): boolean {
		return this.pending.length >= this.flushThreshold;
	}

	/** Resets both watermarks after a full snapshot restore. */
	reset(watermark: number): void {
		this.watermarkSeq = watermark;
		this.lastWrittenSeq = watermark;
		this.pending = [];
		this.fileDirty = false;
		this.cancelIdleMerge();
	}

	/** Adopts a watermark after a document commit that absorbed the journal. */
	adopt(watermark: number): void {
		this.watermarkSeq = Math.max(this.watermarkSeq, watermark);
		this.lastWrittenSeq = Math.max(this.lastWrittenSeq, watermark);
		this.pending = [];
	}

	/** Adopts a full-document fallback commit and truncates the absorbed journal. */
	async adoptFromDocument(watermark: number): Promise<void> {
		this.adopt(watermark);
		await this.clearFile();
	}

	/** Reapplies pending card states after the deck index is hydrated. */
	applyPending(includeSpellingAttempts: boolean): void {
		if (this.pending.length > 0) this.host.apply(this.pending, includeSpellingAttempts);
	}

	/**
	 * Appends one pure answer to the journal, then installs it in memory.
	 * Sequence allocation happens only after a dirty journal file is settled, so
	 * entries can never collide with lines left behind by an interrupted merge.
	 */
	async append(transition: SessionWriteSet): Promise<SessionJournalAppendResult> {
		const journal = this.journal;
		if (!journal) return { kind: "unavailable" };
		if (this.fileDirty && this.pending.length === 0) {
			try {
				await this.mergeNow();
			} catch (error) {
				return { kind: "settle-failed", error };
			}
		}
		const entries = this.createEntries(transition);
		try {
			await journal.append(entries);
		} catch (error) {
			return { kind: "append-failed", error };
		}
		const highest = entries[entries.length - 1]?.seq;
		if (highest !== undefined) this.lastWrittenSeq = Math.max(this.lastWrittenSeq, highest);
		this.pending.push(...entries);
		this.fileDirty = true;
		this.host.apply(entries, true);
		this.scheduleIdleMerge();
		return { kind: "appended" };
	}

	/** Rebuilds pending state from the journal after a full memory reset. */
	async replay(): Promise<void> {
		this.pending = [];
		this.lastWrittenSeq = this.watermarkSeq;
		this.fileDirty = false;
		this.cancelIdleMerge();
		const journal = this.journal;
		if (!journal) return;
		let entries: SessionJournalEntry[];
		try {
			entries = await journal.load();
		} catch (error) {
			// The journal is a durability aid; a read failure must never block startup.
			this.fileDirty = true;
			console.warn("Failed to read the local session journal:", error);
			return;
		}
		const pending = entries
			.filter((entry) => entry.seq > this.watermarkSeq)
			.sort((left, right) => left.seq - right.seq);
		this.lastWrittenSeq = entries.reduce(
			(maximum, entry) => Math.max(maximum, entry.seq),
			this.watermarkSeq,
		);
		if (pending.length === 0) {
			// Entries at or below the persisted sequence were merged before a crash
			// interrupted the truncation; their answers are already in data.json.
			if (entries.length > 0) await this.clearFile();
			return;
		}
		this.pending = pending;
		this.fileDirty = true;
		this.host.apply(pending, true);
	}

	/** Merges every journal entry above the persisted sequence into data.json. */
	async mergeNow(): Promise<void> {
		const journal = this.journal;
		if (!journal) return;
		this.cancelIdleMerge();
		const entries = await journal.load();
		const pending = entries
			.filter((entry) => entry.seq > this.watermarkSeq)
			.sort((left, right) => left.seq - right.seq);
		if (pending.length === 0) {
			if (entries.length > 0 || this.fileDirty) await this.clearFile();
			this.pending = [];
			return;
		}
		// Entries loaded from disk but not applied in this process (for example when
		// the startup read failed) still need to reach memory before the build.
		const appliedSequences = new Set(this.pending.map((entry) => entry.seq));
		const unseen = pending.filter((entry) => !appliedSequences.has(entry.seq));
		if (unseen.length > 0) this.host.apply(unseen, true);
		const highestWritten = entries.reduce(
			(maximum, entry) => Math.max(maximum, entry.seq),
			Math.max(this.watermarkSeq, this.lastWrittenSeq),
		);
		const mergeWatermark = Math.max(highestWritten, this.watermarkSeq);
		await this.host.merge(mergeWatermark);
		this.watermarkSeq = Math.max(this.watermarkSeq, mergeWatermark);
		this.lastWrittenSeq = Math.max(this.lastWrittenSeq, mergeWatermark);
		this.pending = [];
		await this.clearFile();
	}

	async tryMerge(): Promise<boolean> {
		if (!this.journal || !this.hasUnmerged()) return true;
		try {
			await this.mergeNow();
			return true;
		} catch (error) {
			console.warn("Failed to merge the local session journal into data.json:", error);
			return false;
		}
	}

	/** Merges pending work before a full-document write replaces memory. */
	async mergeBeforeWrite(): Promise<void> {
		if (!this.journal || !this.hasUnmerged()) return;
		await this.mergeNow();
	}

	cancelIdleMerge(): void {
		if (this.idleTimer === null) return;
		this.timer.clearTimeout(this.idleTimer);
		this.idleTimer = null;
	}

	dispose(): void {
		this.disposed = true;
		this.cancelIdleMerge();
	}

	private scheduleIdleMerge(): void {
		this.cancelIdleMerge();
		if (this.disposed || this.pending.length === 0) return;
		this.idleTimer = this.timer.setTimeout(() => {
			this.idleTimer = null;
			this.host.requestMerge();
		}, this.idleFlushMilliseconds);
	}

	private async clearFile(): Promise<void> {
		const journal = this.journal;
		this.cancelIdleMerge();
		if (!journal) return;
		try {
			await journal.clear();
			this.fileDirty = false;
		} catch (error) {
			// The answers are already in data.json; the next startup merge will drop
			// the stale duplicate lines instead of replaying them.
			this.fileDirty = true;
			console.warn("Failed to truncate the local session journal:", error);
		}
	}

	private createEntries(transition: SessionWriteSet): SessionJournalEntry[] {
		const at = Date.now();
		let seq = this.lastWrittenSeq;
		const entries: SessionJournalEntry[] = [];
		for (const update of transition.cardUpdates) {
			entries.push({
				seq: ++seq,
				at,
				kind: "card-update",
				cardUpdate: {
					deckId: update.deckId,
					cardId: update.cardId,
					fsrsCard: this.host.serializeFsrsCard(update.fsrsCard),
				},
			});
		}
		for (const attempt of transition.spellingAttempts) {
			entries.push({
				seq: ++seq,
				at,
				kind: "spelling-attempt",
				spellingAttempt: {
					cardId: attempt.cardId,
					correct: attempt.correct,
					attemptedAt: attempt.attemptedAt,
				},
			});
		}
		return entries;
	}
}
