import { describe, expect, it } from "vite-plus/test";
import {
	extractCardIdentityMarker,
	extractFirstTag,
	formatCardBlock,
	formatCardIdentityMarker,
	hasFlashcardSyntax,
	isMarkerLine,
} from "../cardFormat";

describe("card format markers", () => {
	it("recognizes marker lines with surrounding whitespace", () => {
		expect(isMarkerLine("  ??  ", "??")).toBe(true);
		expect(isMarkerLine("prefix ??", "??")).toBe(false);
	});

	it("detects flashcard syntax only when required markers are line markers", () => {
		expect(
			hasFlashcardSyntax(`#单词
front
??
back
;;`),
		).toBe(true);
		expect(hasFlashcardSyntax("#单词\nfront ?? back ;;")).toBe(false);
		expect(hasFlashcardSyntax("#单词\nfront\n??\nback")).toBe(false);
	});

	it("round-trips a vault-wide card identity marker", () => {
		const cardIdentity = "550e8400-e29b-41d4-a716-446655440000";
		const marker = formatCardIdentityMarker(cardIdentity);

		expect(marker).toBe(`<!-- wsr-card-id: ${cardIdentity} -->`);
		expect(extractCardIdentityMarker(marker)).toBe(cardIdentity);
		expect(extractCardIdentityMarker("front text")).toBeNull();
	});
});

describe("extractFirstTag", () => {
	it("extracts the first flashcard tag including Chinese characters", () => {
		expect(extractFirstTag("\n  #单词\n#other\ncontent")).toBe("#单词");
	});

	it("ignores inline hash text that is not a line tag", () => {
		expect(extractFirstTag("front text #单词\n内容")).toBeNull();
	});
});

describe("formatCardBlock", () => {
	it("trims card fields and includes explanation only when present", () => {
		expect(formatCardBlock(" front ", " back ", "\n", " explanation ")).toBe(
			"front\n??\nback\n::\nexplanation",
		);
		expect(formatCardBlock(" front ", " back ", "\n", "   ")).toBe("front\n??\nback");
		expect(formatCardBlock(" front ", " back ", "\n")).toBe("front\n??\nback");
	});

	it("formats every line ending from the required newline argument", () => {
		expect(formatCardBlock("front", "back", "\r\n", "note")).toBe(
			"front\r\n??\r\nback\r\n::\r\nnote",
		);
		expect(formatCardBlock("front\nline", "back", "\r\n")).toBe("front\r\nline\r\n??\r\nback");
	});

	it("places the card identity marker before the front content", () => {
		expect(
			formatCardBlock(
				"front",
				"back",
				"\n",
				undefined,
				"550e8400-e29b-41d4-a716-446655440000",
			),
		).toBe(`<!-- wsr-card-id: 550e8400-e29b-41d4-a716-446655440000 -->
front
??
back`);
	});
});
