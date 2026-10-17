import { normalizePath, type DataAdapter } from "obsidian";
import {
	parseSessionJournal,
	serializeSessionJournalEntry,
	type SessionJournalEntry,
	type SessionJournalStore,
} from "../domain/storage/sessionJournal";

/** One JSON object per line; local-only and never Sync-tracked. */
export const SESSION_JOURNAL_FILE_NAME = "session-journal.jsonl";

/**
 * Creates the production session journal in the plugin directory. Returns
 * `null` when the Obsidian adapter or the plugin directory is unavailable so
 * the repository keeps its previous full-document durability path.
 */
export function createSessionJournalStore(
	adapter: DataAdapter | undefined,
	pluginDirectory: string | undefined,
): SessionJournalStore | null {
	if (!adapter || !pluginDirectory) return null;
	return new ObsidianSessionJournalStore(adapter, pluginDirectory);
}

class ObsidianSessionJournalStore implements SessionJournalStore {
	private readonly path: string;

	constructor(
		private readonly adapter: DataAdapter,
		pluginDirectory: string,
	) {
		this.path = normalizePath(`${pluginDirectory}/${SESSION_JOURNAL_FILE_NAME}`);
	}

	async load(): Promise<SessionJournalEntry[]> {
		try {
			if (!(await this.adapter.exists(this.path))) return [];
			return parseSessionJournal(await this.adapter.read(this.path));
		} catch {
			// A damaged journal must never prevent startup; data.json stays authoritative.
			return [];
		}
	}

	async append(entries: readonly SessionJournalEntry[]): Promise<void> {
		if (entries.length === 0) return;
		// DataAdapter.append is a single local append; the resolution is the durability
		// point the repository relies on before publishing the next card.
		await this.adapter.append(
			this.path,
			entries.map((entry) => serializeSessionJournalEntry(entry)).join(""),
		);
	}

	async clear(): Promise<void> {
		if (await this.adapter.exists(this.path)) await this.adapter.remove(this.path);
	}
}
