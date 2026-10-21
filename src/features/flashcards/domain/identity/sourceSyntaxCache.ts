import type { FlashCard } from "../../../../core/shared/types";

/** Reusable source-derived syntax; never contains FSRS learning state. */
export interface CachedSourceSyntax {
	readonly content: string;
	readonly tag: string | null;
	readonly hasCards: boolean;
	readonly cards?: readonly Omit<FlashCard, "fsrsCard">[];
	/** Retained bytes estimated by the caller, which knows which strings are kept. */
	readonly bytes: number;
}

interface SourceSyntaxCacheLimits {
	readonly maxBytes?: number;
	readonly maxEntries?: number;
}

const SOURCE_SYNTAX_CACHE_BYTES = 32 * 1_048_576;
const SOURCE_SYNTAX_CACHE_ENTRIES = 2048;

/**
 * Bounded source-syntax cache for repeated full scans. Admissions are rejected
 * rather than evicting warm entries, so revisiting sources in scan order does
 * not thrash the whole cache every time.
 */
export class SourceSyntaxCache {
	private readonly entries = new Map<string, CachedSourceSyntax>();
	private bytes = 0;
	private readonly maxBytes: number;
	private readonly maxEntries: number;

	constructor(limits: SourceSyntaxCacheLimits = {}) {
		this.maxBytes = limits.maxBytes ?? SOURCE_SYNTAX_CACHE_BYTES;
		this.maxEntries = limits.maxEntries ?? SOURCE_SYNTAX_CACHE_ENTRIES;
	}

	/** A hit requires the same content; a changed source never reuses old syntax. */
	get(path: string, content: string): CachedSourceSyntax | null {
		const entry = this.entries.get(path);
		return entry?.content === content ? entry : null;
	}

	set(path: string, entry: CachedSourceSyntax): void {
		const previous = this.entries.get(path);
		if (previous) this.bytes -= previous.bytes;
		this.entries.delete(path);
		if (this.bytes + entry.bytes > this.maxBytes || this.entries.size >= this.maxEntries) {
			return;
		}
		this.entries.set(path, entry);
		this.bytes += entry.bytes;
	}

	/** Drops entries whose source is no longer part of the current scan. */
	retain(paths: ReadonlySet<string>): void {
		for (const [path, entry] of this.entries) {
			if (paths.has(path)) continue;
			this.entries.delete(path);
			this.bytes -= entry.bytes;
		}
	}

	stats(): { entries: number; bytes: number } {
		return { entries: this.entries.size, bytes: this.bytes };
	}
}
