import { describe, expect, it, vi } from "vitest";
import { resolveLinkedDefinitions, type RecordValue } from "../linked-definitions";

function record(keyText: string, definition: string): RecordValue {
	return { keyText, definition };
}

function dictionary(entries: Record<string, readonly RecordValue[]>) {
	return vi.fn(async (key: string) => entries[key] ?? []);
}

describe("linked dictionary definitions", () => {
	it.each([false, true])(
		"keeps coordinate's definition when aliases come first: %s",
		async (linksFirst) => {
			const definition = record("coordinate", "<p>to organize an activity</p>");
			const aliases = [
				record("co ordinate", "@@@LINK=co-ordinate\r\n"),
				record("co-ordinate", "@@@LINK=coordinate\r\n"),
			];
			const read = dictionary({
				coordinate: linksFirst ? [...aliases, definition] : [definition, ...aliases],
			});
			expect(await resolveLinkedDefinitions("coordinate", read)).toEqual([definition]);
			expect(read).toHaveBeenCalledTimes(1);
		},
	);

	it("resolves every linked target while keeping separate senses", async () => {
		const direct = record("entry", "<p>direct</p>");
		const noun = record("target", "<p>noun</p>");
		const verb = record("target", "<p>verb</p>");
		const other = record("other", "<p>other</p>");
		const read = dictionary({
			entry: [record("alias", "@@@LINK=target"), direct, record("alias", "@@@LINK=other")],
			target: [noun, verb],
			other: [other],
		});
		expect(await resolveLinkedDefinitions("entry", read)).toEqual([direct, noun, verb, other]);
	});

	it("reads shared targets once and removes identical repeated records", async () => {
		const definition = record("target", "<p>target</p>");
		const read = dictionary({
			entry: [record("entry", "@@@LINK=target"), record("entry", "@@@LINK=TARGET")],
			target: [definition, definition],
		});
		expect(await resolveLinkedDefinitions("entry", read)).toEqual([definition]);
		expect(read.mock.calls.map(([key]) => key)).toEqual(["entry", "target"]);
	});

	it("keeps valid definitions beside missing, cyclic, and empty links", async () => {
		const definition = record("target", "<p>target</p>");
		const read = dictionary({
			entry: [
				record("entry", "@@@LINK=missing"),
				record("entry", "@@@LINK=target"),
				record("entry", "@@@LINK=   \r\n"),
			],
			target: [record("target", "@@@LINK=entry"), definition],
		});
		expect(await resolveLinkedDefinitions("entry", read)).toEqual([definition]);
	});

	it("resolves a pure alias chain with whitespace and case variations", async () => {
		const definition = record("target", "<p>target</p>");
		const read = dictionary({
			entry: [record("entry", "\uFEFF \r\n@@@link= Other-Word \r\n")],
			otherword: [record("other word", "@@@LINK=target")],
			target: [definition],
		});
		expect(await resolveLinkedDefinitions("entry", read)).toEqual([definition]);
	});

	it("does not treat a marker embedded in an HTML definition as a redirect", async () => {
		const definition = record("entry", "<p>Explanation of @@@LINK=target</p>");
		expect(
			await resolveLinkedDefinitions("entry", dictionary({ entry: [definition] })),
		).toEqual([definition]);
	});

	it("returns no definitions for a pure cycle", async () => {
		const read = dictionary({
			entry: [record("entry", "@@@LINK=target")],
			target: [record("target", "@@@LINK=entry")],
		});
		expect(await resolveLinkedDefinitions("entry", read)).toEqual([]);
		expect(read).toHaveBeenCalledTimes(2);
	});

	it.each([8, 9])("only resolves targets within eight redirects: %s", async (depth) => {
		const definition = record(`word${depth}`, "<p>target</p>");
		const read = vi.fn(async (key: string) => {
			const index = Number(key.slice(4));
			return index === depth ? [definition] : [record(key, `@@@LINK=word${index + 1}`)];
		});
		expect(await resolveLinkedDefinitions("word0", read)).toEqual(
			depth === 8 ? [definition] : [],
		);
		expect(read).toHaveBeenCalledTimes(9);
	});

	it("bounds fan-out to 64 key reads", async () => {
		const read = vi.fn(async (key: string) =>
			Array.from({ length: 64 }, (_, index) => record(key, `@@@LINK=${key}x${index}`)),
		);
		expect(await resolveLinkedDefinitions("entry", read)).toEqual([]);
		expect(read).toHaveBeenCalledTimes(64);
	});

	it("bounds combined results to 64 definitions", async () => {
		const direct = Array.from({ length: 63 }, (_, index) => record("entry", `<p>${index}</p>`));
		const read = dictionary({
			entry: [...direct, record("entry", "@@@LINK=target")],
			target: [record("target", "<p>noun</p>"), record("target", "<p>verb</p>")],
		});
		expect(await resolveLinkedDefinitions("entry", read)).toEqual([
			...direct,
			record("target", "<p>noun</p>"),
		]);
	});
});
