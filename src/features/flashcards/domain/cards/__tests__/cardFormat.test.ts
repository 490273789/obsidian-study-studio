import { describe, expect, it } from "vite-plus/test";
import {
	containsReservedMarkerLine,
	extractCardIdentityMarker,
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

	it("detects reserved marker lines without flagging inline marker text", () => {
		expect(containsReservedMarkerLine("front text\n::\nexplanation")).toBe(true);
		expect(containsReservedMarkerLine("front text with :: inline")).toBe(false);
	});

	it("round-trips a vault-wide card identity marker", () => {
		const cardIdentity = "550e8400-e29b-41d4-a716-446655440000";
		const marker = formatCardIdentityMarker(cardIdentity);

		expect(marker).toBe(`<!-- wsr-card-id: ${cardIdentity} -->`);
		expect(extractCardIdentityMarker(marker)).toBe(cardIdentity);
		expect(extractCardIdentityMarker("front text")).toBeNull();
	});
});

describe("formatCardBlock", () => {
	it("trims card fields and includes explanation only when present", () => {
		expect(formatCardBlock(" front ", " back ", " explanation ")).toBe(
			"front\n??\nback\n::\nexplanation",
		);
		expect(formatCardBlock(" front ", " back ", "   ")).toBe("front\n??\nback");
		expect(formatCardBlock(" front ", " back ")).toBe("front\n??\nback");
	});

	it("places the card identity marker before the front content", () => {
		expect(formatCardBlock("front", "back", undefined, "550e8400-e29b-41d4-a716-446655440000"))
			.toBe(`<!-- wsr-card-id: 550e8400-e29b-41d4-a716-446655440000 -->
front
??
back`);
	});
});
