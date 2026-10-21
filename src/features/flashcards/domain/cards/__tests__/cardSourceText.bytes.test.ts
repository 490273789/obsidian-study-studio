import { describe, expect, it } from "vite-plus/test";
import { editCards } from "../cardSourceText";
import { formatCardIdentityMarker } from "../cardFormat";

const IDS = [
	"550e8400-e29b-41d4-a716-446655440000",
	"7d444840-9dc0-11d1-b245-5ffdce74fad2",
	"6ba7b810-9dad-11d1-80b4-00c04fd430c8",
	"16fd2706-8baf-433b-82eb-8c7fada847da",
] as const;

function marker(identity: string): string {
	return formatCardIdentityMarker(identity);
}

function block(identity: string, front: string, back: string, newline: "\n" | "\r\n"): string {
	return [marker(identity), front, "??", back, ";;"].join(newline);
}

describe("card source bytes", () => {
	it("keeps CRLF sources and bytes outside edited blocks", () => {
		const newline = "\r\n";
		const source =
			`#单词${newline}${newline}` +
			`${block(IDS[0], "苹果", "apple", newline)}${newline}` +
			`${block(IDS[1], "香蕉", "banana", newline)}${newline}` +
			`${block(IDS[2], "梨", "pear", newline)}${newline}尾部正文${newline}${newline}`;

		const result = editCards(
			source,
			[
				{
					kind: "edit",
					identity: IDS[1],
					content: { front: "香蕉 updated", back: "banana" },
				},
			],
			() => IDS[3],
		);

		expect(result.nextContent).not.toMatch(/(?<!\r)\n/);
		expect(result.nextContent.startsWith(`#单词${newline}${newline}`)).toBe(true);
		expect(result.nextContent.endsWith(`${newline}尾部正文${newline}${newline}`)).toBe(true);
		expect(result.nextContent).toContain(
			`${marker(IDS[1])}${newline}香蕉 updated${newline}??${newline}banana${newline};;`,
		);
	});

	it("follows each block's own line ending in a mixed-ending source", () => {
		const source =
			`#单词\r\n\r\n${block(IDS[0], "苹果", "apple", "\r\n")}\n\n` +
			`${block(IDS[1], "香蕉", "banana", "\n")}\n`;

		const updatedCrlf = editCards(
			source,
			[{ kind: "edit", identity: IDS[0], content: { front: "苹果 updated", back: "apple" } }],
			() => IDS[3],
		);
		expect(updatedCrlf.nextContent).toContain(
			`${marker(IDS[0])}\r\n苹果 updated\r\n??\r\napple\r\n;;`,
		);

		const updatedLf = editCards(
			source,
			[
				{
					kind: "edit",
					identity: IDS[1],
					content: { front: "香蕉 updated", back: "banana" },
				},
			],
			() => IDS[3],
		);
		expect(updatedLf.nextContent).toContain(`${marker(IDS[1])}\n香蕉 updated\n??\nbanana\n;;`);
	});

	it("preserves a BOM and the no-final-newline tail", () => {
		const source = `\uFEFF#单词\n\n${block(IDS[0], "苹果", "apple", "\n")}`;
		const result = editCards(
			source,
			[{ kind: "edit", identity: IDS[0], content: { front: "苹果 updated", back: "apple" } }],
			() => IDS[3],
		);
		expect(result.nextContent.startsWith("\uFEFF#单词\n\n")).toBe(true);
		expect(result.nextContent.endsWith(";;")).toBe(true);
	});

	it("inserts additions using the last block's line ending and keeps the tail", () => {
		const source = `#单词\r\n\r\n${block(IDS[0], "苹果", "apple", "\r\n")}\r\n尾部正文`;
		const result = editCards(
			source,
			[{ kind: "add", content: { front: "葡萄", back: "grape" } }],
			() => IDS[3],
		);
		expect(result.nextContent).toContain(`${marker(IDS[3])}\r\n葡萄\r\n??\r\ngrape\r\n;;\r\n`);
		expect(result.nextContent.endsWith("\r\n尾部正文")).toBe(true);
		expect(result.nextContent).not.toMatch(/(?<!\r)\n/);
	});

	it("edits one block in a large source without touching the rest", () => {
		const blocks = Array.from({ length: 2000 }, (_, index) => {
			const identity = String(index).padStart(8, "0");
			return `${marker(`${identity}-0000-4000-8000-000000000000`)}\nfront ${index}\n??\nback ${index}\n;;`;
		});
		const source = `#单词\n\n${blocks.join("\n\n")}`;
		const targetIdentity = `${String(1000).padStart(8, "0")}-0000-4000-8000-000000000000`;
		const result = editCards(
			source,
			[
				{
					kind: "edit",
					identity: targetIdentity,
					content: { front: "changed", back: "back 1000" },
				},
			],
			() => IDS[3],
		);
		expect(result.nextContent).not.toBe(source);
		expect(result.nextContent).toContain(
			`${marker(targetIdentity)}\nchanged\n??\nback 1000\n;;`,
		);
		expect(result.nextContent.startsWith("#单词\n\n")).toBe(true);
		expect(result.nextContent.endsWith("back 1999\n;;")).toBe(true);
	});
});
