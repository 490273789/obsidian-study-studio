import {
	parseSessionJournal,
	serializeSessionJournalEntry,
	type SessionJournalEntry,
	type SessionJournalStore,
} from "../sessionJournal";

/**
 * In-memory journal used by repository and port tests. It keeps the same JSONL
 * shape as the Obsidian adapter so corruption and truncation behavior can be
 * exercised without a vault.
 */
export class MemorySessionJournal implements SessionJournalStore {
	content = "";
	failNextAppend = false;
	failNextLoad = false;
	failNextClear = false;
	private readonly appendedBatches: SessionJournalEntry[][] = [];

	async load(): Promise<SessionJournalEntry[]> {
		if (this.failNextLoad) {
			this.failNextLoad = false;
			throw new Error("journal read failed");
		}
		return parseSessionJournal(this.content);
	}

	async append(entries: readonly SessionJournalEntry[]): Promise<void> {
		if (this.failNextAppend) {
			this.failNextAppend = false;
			throw new Error("journal write failed");
		}
		if (entries.length === 0) return;
		this.appendedBatches.push([...entries]);
		this.content += entries.map((entry) => serializeSessionJournalEntry(entry)).join("");
	}

	async clear(): Promise<void> {
		if (this.failNextClear) {
			this.failNextClear = false;
			throw new Error("journal truncate failed");
		}
		this.content = "";
	}

	entries(): SessionJournalEntry[] {
		return parseSessionJournal(this.content);
	}

	appendedEntryCount(): number {
		return this.appendedBatches.reduce((total, batch) => total + batch.length, 0);
	}

	appendRaw(line: string): void {
		this.content += line;
	}
}

export interface ManualJournalTimer {
	readonly timer: {
		setTimeout(handler: () => void, milliseconds: number): unknown;
		clearTimeout(handle: unknown): void;
	};
	runAll(): void;
	pendingCount(): number;
}

/** Deterministic replacement for the repository's idle-merge timer. */
export function createManualJournalTimer(): ManualJournalTimer {
	const handlers = new Map<number, () => void>();
	let nextHandle = 0;
	return {
		timer: {
			setTimeout(handler) {
				const handle = ++nextHandle;
				handlers.set(handle, handler);
				return handle;
			},
			clearTimeout(handle) {
				if (typeof handle === "number") handlers.delete(handle);
			},
		},
		runAll() {
			const pending = [...handlers.values()];
			handlers.clear();
			for (const handler of pending) handler();
		},
		pendingCount() {
			return handlers.size;
		},
	};
}
