import { describe, expect, it } from "vite-plus/test";
import { editCards, maintainIdentities } from "../cardSourceText";
import { parseFlashcards } from "../parser";
import { extractFirstTag, formatCardIdentityMarker } from "../cardFormat";

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
	it("keeps the discovered legacy deck tag when the first card also contains a standalone hashtag", () => {
		const front = "#wordTag vocabulary list\n## apple\n#biology";
		const source = block(IDS[0], front, "before", "\n");
		expect(extractFirstTag(source)).toBe("#wordTag");
		const read = parseFlashcards(source, "words.md")[0]!;
		expect(read.front).toBe(front);
		const edit = editCards(
			source,
			[{ kind: "edit", identity: read.id, content: { front: read.front, back: "after" } }],
			() => IDS[1],
		);
		expect(extractFirstTag(edit.nextContent)).toBe("#wordTag");
		expect(parseFlashcards(edit.nextContent, "words.md")[0]).toMatchObject({
			front,
			back: "after",
			id: IDS[0],
		});
	});

	it("retains the deck tag and card contents when a legacy note has a preamble", () => {
		const metadata = "---\r\n#comment\r\ntitle: Words\r\n---\r\n";
		const preamble = metadata + "# Heading";
		const tag = "  #单词  \r\n";
		const source = preamble + "\r\n" + tag + "front\r\n??\r\nback\r\n;;";
		expect(extractFirstTag(source)).toBe("#单词");
		const registered = maintainIdentities(source, { kind: "register-missing" }, () => IDS[0]);
		const [card] = parseFlashcards(registered.nextContent, "words.md");
		expect(card).toMatchObject({ id: IDS[0], front: "# Heading\nfront" });
		const edited = editCards(
			registered.nextContent,
			[{ kind: "edit", identity: IDS[0], content: { front: card!.front, back: "edited" } }],
			() => IDS[1],
		);
		expect(edited.nextContent.startsWith(metadata)).toBe(true);
		expect(edited.nextContent).toContain(tag);
		expect(parseFlashcards(edited.nextContent, "words.md")[0]).toMatchObject({
			front: card!.front,
			back: "edited",
			id: IDS[0],
		});
		const removed = editCards(
			registered.nextContent,
			[{ kind: "delete", identity: IDS[0] }],
			() => IDS[1],
		);
		expect(removed.nextContent).toBe(metadata + tag);
	});

	it("starts a new line when appending the first card after frontmatter at EOF", () => {
		const metadata = "\uFEFF---\r\ntitle: Words\r\n---";
		const result = editCards(
			metadata,
			[{ kind: "add", content: { front: "front", back: "back" } }],
			() => IDS[0],
		);
		expect(result.nextContent.startsWith(metadata + "\r\n")).toBe(true);
		expect(parseFlashcards(result.nextContent, "words.md")[0]).toMatchObject({
			front: "front",
			back: "back",
			id: IDS[0],
		});
	});

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

	it("preserves a BOM attached to the first line of an untagged source", () => {
		const content = `\uFEFF${block(IDS[0], "苹果", "apple", "\n")}\n尾部正文`;
		const updated = editCards(
			content,
			[{ kind: "edit", identity: IDS[0], content: { front: "苹果 updated", back: "apple" } }],
			() => IDS[3],
		);
		const deleted = editCards(content, [{ kind: "delete", identity: IDS[0] }], () => IDS[3]);
		const registered = maintainIdentities(
			"\uFEFF苹果\n??\napple\n;;",
			{ kind: "register-missing" },
			() => IDS[0],
		);
		const repaired = maintainIdentities(
			content,
			{ kind: "replace-markers", identities: [IDS[1]] },
			() => IDS[3],
		);

		expect(updated.nextContent).toBe(
			`\uFEFF${block(IDS[0], "苹果 updated", "apple", "\n")}\n尾部正文`,
		);
		expect(deleted.nextContent).toBe("\uFEFF尾部正文");
		expect(registered.nextContent).toBe(`\uFEFF${block(IDS[0], "苹果", "apple", "\n")}`);
		expect(repaired.nextContent).toBe(
			`\uFEFF${block(IDS[1], "苹果", "apple", "\n")}\n尾部正文`,
		);
	});

	it("replaces the whole first card when its front starts with a tag after the identity", () => {
		const source = `${block(IDS[0], "#word", "apple", "\n")}\n尾部正文`;
		const result = editCards(
			source,
			[{ kind: "edit", identity: IDS[0], content: { front: "new front", back: "apple" } }],
			() => IDS[3],
		);
		expect(result.nextContent).toBe(`${block(IDS[0], "new front", "apple", "\n")}\n尾部正文`);
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
