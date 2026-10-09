import { createEmptyCard } from "ts-fsrs";
import { describe, expect, it } from "vite-plus/test";
import type { Deck } from "../../../../../core/shared/types";
import {
	createPdfDocumentHtml,
	DECK_PDF_PRINT_STYLES,
	ensurePdfExtension,
	escapeHtml,
	getDeckPdfFileStem,
	getDeckPdfRows,
} from "../deckPdfViewModel";

function makeDeck(): Deck {
	return {
		id: "cards/词汇.md",
		name: "英语词汇",
		filePath: "cards/词汇.md",
		tag: "#英语",
		cards: [
			{
				id: "card-1",
				front: "## apple",
				back: "n. 苹果",
				explanation: "这部分不应导出",
				fsrsCard: createEmptyCard(),
				sourceFile: "cards/词汇.md",
				indexInFile: 0,
			},
			{
				id: "card-2",
				front: "## science",
				back: "n. 科学",
				fsrsCard: createEmptyCard(),
				sourceFile: "cards/词汇.md",
				indexInFile: 1,
			},
		],
		studyCount: 0,
		lastStudied: null,
	};
}

describe("deckPdfViewModel", () => {
	it("exports only front and back content for cards", () => {
		expect(getDeckPdfRows(makeDeck())).toEqual([
			{ front: "## apple", back: "n. 苹果" },
			{ front: "## science", back: "n. 科学" },
		]);
	});

	it("creates a safe PDF document file stem from deck name", () => {
		expect(getDeckPdfFileStem(" 英语/词汇:*? ")).toBe("英语-词汇---");
		expect(getDeckPdfFileStem("...")).toBe("flashcards");
		expect(getDeckPdfFileStem("")).toBe("flashcards");
	});

	it("ensures PDF extension is present", () => {
		expect(ensurePdfExtension("/Users/test/英语词汇")).toBe("/Users/test/英语词汇.pdf");
		expect(ensurePdfExtension("/Users/test/英语词汇.PDF")).toBe("/Users/test/英语词汇.PDF");
		expect(ensurePdfExtension("/Users/test/英语词汇.pdf")).toBe("/Users/test/英语词汇.pdf");
	});

	it("escapes HTML characters safely", () => {
		expect(escapeHtml('<script>"alert"&done</script>')).toBe(
			"&lt;script&gt;&quot;alert&quot;&amp;done&lt;/script&gt;",
		);
	});

	it("generates full HTML document containing print styles and base uri", () => {
		const html = createPdfDocumentHtml("My Deck", "app://obsidian/", "<main>Content</main>");
		expect(html).toContain("<title>My Deck</title>");
		expect(html).toContain('<base href="app://obsidian/">');
		expect(html).toContain(DECK_PDF_PRINT_STYLES);
		expect(html).toContain('<body class="flashcard-pdf-exporting"><main>Content</main></body>');
	});
});
