import { describe, expect, it } from "vite-plus/test";
import { SourceSyntaxCache, type CachedSourceSyntax } from "../sourceSyntaxCache";

function entry(content: string, bytes: number, front = "word"): CachedSourceSyntax {
	return {
		content,
		tag: "#单词",
		hasCards: true,
		bytes,
		cards: [
			{
				id: "a.md::0",
				front,
				back: "meaning",
				sourceFile: "a.md",
				indexInFile: 0,
			},
		],
	};
}

describe("SourceSyntaxCache", () => {
	it("misses when the source content changed and hits when it is identical", () => {
		const cache = new SourceSyntaxCache({ maxEntries: 4, maxBytes: 100 });
		const cached = entry("content", 10);
		cache.set("a.md", cached);

		expect(cache.get("a.md", "content")).toBe(cached);
		expect(cache.get("a.md", "changed")).toBeNull();
		expect(cache.get("missing.md", "content")).toBeNull();
	});

	it("rejects admissions past the entry limit without evicting warm entries", () => {
		const cache = new SourceSyntaxCache({ maxEntries: 2, maxBytes: 100 });
		cache.set("a.md", entry("a", 10));
		cache.set("b.md", entry("b", 10));
		cache.set("c.md", entry("c", 10));

		expect(cache.stats()).toEqual({ entries: 2, bytes: 20 });
		expect(cache.get("a.md", "a")).not.toBeNull();
		expect(cache.get("c.md", "c")).toBeNull();
	});

	it("rejects admissions past the byte budget", () => {
		const cache = new SourceSyntaxCache({ maxEntries: 4, maxBytes: 15 });
		cache.set("a.md", entry("a", 10));
		cache.set("b.md", entry("b", 6));

		expect(cache.stats()).toEqual({ entries: 1, bytes: 10 });
		expect(cache.get("b.md", "b")).toBeNull();
	});

	it("replaces an entry and re-accounts its bytes", () => {
		const cache = new SourceSyntaxCache({ maxEntries: 1, maxBytes: 100 });
		cache.set("a.md", entry("old", 10));
		const next = entry("new", 30, "term");
		cache.set("a.md", next);

		expect(cache.get("a.md", "new")).toBe(next);
		expect(cache.get("a.md", "old")).toBeNull();
		expect(cache.stats()).toEqual({ entries: 1, bytes: 30 });
	});

	it("retains only paths in the current scan", () => {
		const cache = new SourceSyntaxCache({ maxEntries: 4, maxBytes: 100 });
		cache.set("a.md", entry("a", 10));
		cache.set("b.md", entry("b", 20));
		cache.set("c.md", entry("c", 30));

		cache.retain(new Set(["a.md", "c.md"]));

		expect(cache.stats()).toEqual({ entries: 2, bytes: 40 });
		expect(cache.get("b.md", "b")).toBeNull();
	});
});
