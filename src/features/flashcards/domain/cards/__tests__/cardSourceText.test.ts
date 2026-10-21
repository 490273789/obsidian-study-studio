import { describe, expect, it } from "vite-plus/test";
import {
	DeckSourceEditException,
	editCards,
	maintainIdentities,
	validateCardDraft,
} from "../cardSourceText";
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

function stableSource(newline = "\n"): string {
	return [
		"#单词",
		"",
		marker(IDS[0]),
		"苹果",
		"??",
		"apple",
		";;",
		"",
		marker(IDS[1]),
		"香蕉",
		"??",
		"banana",
		"::",
		"黄色水果",
		";;",
		"",
		marker(IDS[2]),
		"梨",
		"??",
		"pear",
		";;",
	].join(newline);
}

function legacySource(newline = "\n"): string {
	return ["#单词", "", "苹果", "??", "apple", ";;", "", "香蕉", "??", "banana", ";;"].join(
		newline,
	);
}

describe("editCards", () => {
	it("updates a card block and preserves bytes outside it", () => {
		const source = stableSource();
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

		expect(result.createdIdentities).toEqual([]);
		expect(result.nextContent).toBe(
			source.replace(
				`${marker(IDS[1])}\n香蕉\n??\nbanana\n::\n黄色水果`,
				`${marker(IDS[1])}\n香蕉 updated\n??\nbanana`,
			),
		);
	});

	it("returns the original source for a semantic no-op update", () => {
		const source = stableSource();
		const result = editCards(
			source,
			[
				{
					kind: "edit",
					identity: IDS[1],
					content: { front: "香蕉", back: "banana", explanation: "黄色水果" },
				},
			],
			() => IDS[3],
		);
		expect(result.nextContent).toBe(source);
	});

	it("keeps an explicitly empty explanation section and creates one when asked", () => {
		const withSection = stableSource();
		const cleared = editCards(
			withSection,
			[
				{
					kind: "edit",
					identity: IDS[1],
					content: { front: "香蕉", back: "banana", explanation: "" },
				},
			],
			() => IDS[3],
		);
		expect(cleared.nextContent).toContain(`${marker(IDS[1])}\n香蕉\n??\nbanana\n::\n\n;;`);

		const withoutSection = stableSource();
		const created = editCards(
			withoutSection,
			[
				{
					kind: "edit",
					identity: IDS[0],
					content: { front: "苹果", back: "apple", explanation: "" },
				},
			],
			() => IDS[3],
		);
		expect(created.nextContent).toContain(`${marker(IDS[0])}\n苹果\n??\napple\n::\n\n;;`);
	});

	it("deletes a middle card with its preceding blank separator only", () => {
		const result = editCards(
			stableSource(),
			[{ kind: "delete", identity: IDS[1] }],
			() => IDS[3],
		);
		expect(result.nextContent).toBe(
			[
				"#单词",
				"",
				marker(IDS[0]),
				"苹果",
				"??",
				"apple",
				";;",
				"",
				marker(IDS[2]),
				"梨",
				"??",
				"pear",
				";;",
			].join("\n"),
		);
	});

	it("keeps the tag prefix when deleting the first card", () => {
		const result = editCards(
			stableSource(),
			[{ kind: "delete", identity: IDS[0] }],
			() => IDS[3],
		);
		expect(result.nextContent.startsWith(`#单词\n\n${marker(IDS[1])}`)).toBe(true);
		expect(result.nextContent).not.toContain(IDS[0]);
	});

	it("inserts additions before trailing prose and returns created identities", () => {
		const source = `${stableSource()}\n尾部正文\n\n`;
		const result = editCards(
			source,
			[
				{
					kind: "add",
					content: { front: " 葡萄 ", back: " grape ", explanation: " fruit " },
				},
			],
			() => IDS[3],
		);
		expect(result.createdIdentities).toEqual([IDS[3]]);
		expect(result.nextContent.endsWith(";;\n尾部正文\n\n")).toBe(true);
		expect(result.nextContent).toContain(`${marker(IDS[3])}\n葡萄\n??\ngrape\n::\nfruit\n;;`);
	});

	it("inserts the first card after the tag line of an empty managed source", () => {
		const result = editCards(
			"#单词\n",
			[{ kind: "add", content: { front: "## apple", back: "苹果" } }],
			() => IDS[3],
		);
		expect(result.createdIdentities).toEqual([IDS[3]]);
		expect(result.nextContent).toBe(`#单词\n\n${marker(IDS[3])}\n## apple\n??\n苹果\n;;\n`);
	});

	it("applies multiple edits against original offsets and validates before writing", () => {
		const source = stableSource();
		const result = editCards(
			source,
			[
				{ kind: "delete", identity: IDS[0] },
				{ kind: "delete", identity: IDS[1] },
				{ kind: "edit", identity: IDS[2], content: { front: "梨 updated", back: "pear" } },
			],
			() => IDS[3],
		);
		expect(result.nextContent.startsWith("#单词\n")).toBe(true);
		expect(result.nextContent).toContain(`${marker(IDS[2])}\n梨 updated\n??\npear\n;;`);
		expect(result.nextContent).not.toContain(IDS[0]);
		expect(result.nextContent).not.toContain(IDS[1]);

		expect(() =>
			editCards(
				source,
				[
					{ kind: "delete", identity: IDS[0] },
					{ kind: "edit", identity: IDS[1], content: { front: "x", back: "" } },
				],
				() => IDS[3],
			),
		).toThrowError(DeckSourceEditException);
	});

	it("throws structured validation errors", () => {
		const source = stableSource();
		const expectError = (operation: Parameters<typeof editCards>[1][number]) => {
			try {
				editCards(source, [operation], () => IDS[3]);
			} catch (error) {
				return (error as DeckSourceEditException).editError;
			}
			return null;
		};

		expect(expectError({ kind: "add", content: { front: "", back: "back" } })).toEqual({
			type: "missing-front",
		});
		expect(expectError({ kind: "add", content: { front: "front", back: "" } })).toEqual({
			type: "missing-back",
		});
		expect(expectError({ kind: "add", content: { front: "front", back: "back\n::" } })).toEqual(
			{ type: "reserved-marker", marker: "::" },
		);
		expect(
			expectError({
				kind: "add",
				content: { front: "front", back: `back\n${marker(IDS[3])}` },
			}),
		).toEqual({ type: "source-file-invalid" });
		expect(expectError({ kind: "delete", identity: IDS[3] })).toEqual({
			type: "card-not-found",
		});
		expect(
			expectError({
				kind: "edit",
				identity: IDS[0],
				content: { front: "f", back: "b" },
			}),
		).toBeNull();
		const duplicateSource = `${stableSource()}\n\n${marker(IDS[0])}\n重复\n??\nduplicate\n;;`;
		expect(() =>
			editCards(duplicateSource, [{ kind: "delete", identity: IDS[0] }], () => IDS[3]),
		).toThrowError(DeckSourceEditException);
	});

	it("returns a new identity for add without a second write", () => {
		const result = editCards(
			stableSource(),
			[{ kind: "add", content: { front: "新卡", back: "new" } }],
			() => IDS[3],
		);
		expect(result.nextContent).toContain(marker(IDS[3]));
	});
});

describe("maintainIdentities", () => {
	it("registers missing markers on valid blocks only and preserves existing ones", () => {
		const source = `${legacySource()}\n\n#单词\n无效块`;
		const generated = [IDS[3], IDS[0]];
		const result = maintainIdentities(source, { kind: "register-missing" }, () =>
			generated.shift()!,
		);

		expect(result.identities).toEqual([IDS[3], IDS[0]]);
		expect(result.nextContent).toContain(`${marker(IDS[3])}\n苹果`);
		expect(result.nextContent).toContain(`${marker(IDS[0])}\n香蕉`);
		expect(result.nextContent.endsWith("\n\n#单词\n无效块")).toBe(true);
	});

	it("returns the source unchanged when every block already has a marker", () => {
		const source = stableSource();
		const result = maintainIdentities(source, { kind: "register-missing" }, () => IDS[3]);
		expect(result.nextContent).toBe(source);
		expect(result.identities).toEqual([]);
	});

	it("replaces markers in block order and preserves block bytes", () => {
		const source = stableSource();
		const result = maintainIdentities(
			source,
			{ kind: "replace-markers", identities: [IDS[3], IDS[0], IDS[1]] },
			() => IDS[2],
		);
		expect(result.nextContent).toContain(`${marker(IDS[3])}\n苹果`);
		expect(result.nextContent).toContain(`${marker(IDS[0])}\n香蕉`);
		expect(result.nextContent).toContain(`${marker(IDS[1])}\n梨`);
		expect(result.nextContent).not.toContain(IDS[2]);
		expect(result.nextContent.replaceAll(/<!--[^\n]*-->\n/g, "")).toBe(
			source.replaceAll(/<!--[^\n]*-->\n/g, ""),
		);
	});

	it("returns the source unchanged when the desired markers already match", () => {
		const source = stableSource();
		const result = maintainIdentities(
			source,
			{ kind: "replace-markers", identities: [IDS[0], IDS[1], IDS[2]] },
			() => IDS[3],
		);
		expect(result.nextContent).toBe(source);
	});

	it("rejects a marker count that does not match the parsed cards", () => {
		expect(() =>
			maintainIdentities(
				stableSource(),
				{ kind: "replace-markers", identities: [IDS[0]] },
				() => IDS[3],
			),
		).toThrowError(DeckSourceEditException);
	});
});

describe("validateCardDraft", () => {
	it("returns missing-front for empty front content", () => {
		expect(validateCardDraft("", "back")).toEqual({ type: "missing-front" });
		expect(validateCardDraft("   ", "back")).toEqual({ type: "missing-front" });
	});

	it("returns missing-back for empty back content", () => {
		expect(validateCardDraft("front", "")).toEqual({ type: "missing-back" });
		expect(validateCardDraft("front", "  \n  ")).toEqual({ type: "missing-back" });
	});

	it("returns reserved-marker when content contains separator lines", () => {
		expect(validateCardDraft("front\n;;", "back")).toEqual({
			type: "reserved-marker",
			marker: ";;",
		});
		expect(validateCardDraft("front", "back\n??")).toEqual({
			type: "reserved-marker",
			marker: "??",
		});
		expect(validateCardDraft("front", "back", "exp\n::")).toEqual({
			type: "reserved-marker",
			marker: "::",
		});
	});

	it("returns null for valid card draft", () => {
		expect(validateCardDraft("Valid Front", "Valid Back", "Optional Explanation")).toBeNull();
	});
});
