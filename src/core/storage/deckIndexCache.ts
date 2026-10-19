import { normalizePath, type DataAdapter } from "obsidian";

/** Local-only format for Markdown-derived deck content. */
export const DECK_INDEX_CACHE_VERSION = 1;

/**
 * The cache deliberately contains only derived data. It is never required to
 * restore a learner's scheduling state and can be discarded on any device.
 */
export interface DeckIndexCache<TDeck> {
	version: typeof DECK_INDEX_CACHE_VERSION;
	updatedAt: string;
	availableTags: string[];
	decks: Record<string, TDeck>;
}

/**
 * Snapshot store for the local deck-index cache.
 *
 * The cache is derived, disposable data. This seam only reads and writes whole
 * snapshots; `FlashcardRepository`/continuity own rebuilding a missing or
 * corrupt cache by scanning Markdown, and refresh it through the same
 * whole-snapshot write.
 */
export interface DeckIndexCacheStore<TDeck> {
	load(): Promise<DeckIndexCache<TDeck> | null>;
	save(cache: DeckIndexCache<TDeck>): Promise<void>;
}

export function createDeckIndexCacheStore<TDeck>(
	adapter: DataAdapter | undefined,
	pluginDirectory: string | undefined,
): DeckIndexCacheStore<TDeck> | null {
	if (!adapter || !pluginDirectory) return null;
	return new ObsidianDeckIndexCacheStore(adapter, pluginDirectory);
}

class ObsidianDeckIndexCacheStore<TDeck> implements DeckIndexCacheStore<TDeck> {
	private readonly directory: string;
	private readonly path: string;

	constructor(
		private readonly adapter: DataAdapter,
		pluginDirectory: string,
	) {
		this.directory = normalizePath(`${pluginDirectory}/cache`);
		this.path = normalizePath(`${this.directory}/deck-index.json`);
	}

	async save(cache: DeckIndexCache<TDeck>): Promise<void> {
		if (!(await this.adapter.exists(this.directory))) {
			await this.adapter.mkdir(this.directory);
		}
		await this.adapter.write(this.path, JSON.stringify(cache));
	}

	async load(): Promise<DeckIndexCache<TDeck> | null> {
		try {
			if (!(await this.adapter.exists(this.path))) return null;
			const parsed: unknown = JSON.parse(await this.adapter.read(this.path));
			if (!isDeckIndexCache<TDeck>(parsed)) return null;
			return parsed;
		} catch {
			// A cache corruption must never prevent Markdown-backed learning data from loading.
			return null;
		}
	}
}

function isDeckIndexCache<TDeck>(value: unknown): value is DeckIndexCache<TDeck> {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<DeckIndexCache<TDeck>>;
	return (
		candidate.version === DECK_INDEX_CACHE_VERSION &&
		typeof candidate.updatedAt === "string" &&
		Array.isArray(candidate.availableTags) &&
		Boolean(candidate.decks) &&
		typeof candidate.decks === "object"
	);
}
