import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DICTIONARY_SETTINGS } from "../domain/configuration";
import type { DictionaryQuerySession } from "../domain/querySession";
import type { DictionaryViewState } from "../domain/types";
import { createDictionarySelectionAdapter } from "../selectionAdapter";
import { defineSandboxDocument } from "../domain/sandbox-document/document";

describe("dictionary selection adapter", () => {
	it("reports enabled sources in 词典目录 order", () => {
		const { adapter } = setup(emptyDictionarySnapshot());
		expect(adapter.sources()).toEqual([
			{ id: "youdao", label: "有道词典", kind: "dictionary" },
			{ id: "ai", label: "AI 词典", kind: "ai" },
			{ id: "local", label: "OALD", kind: "dictionary" },
		]);
	});

	it("preserves local sandbox handles and chapter metadata alongside text", () => {
		const document = defineSandboxDocument("oald", "private HTML");
		const state = emptyDictionarySnapshot();
		state.sources = [
			{
				id: "youdao",
				label: "有道词典",
				kind: "local",
				status: "success",
				error: "",
				activeSectionIndex: 1,
				result: {
					attribution: "",
					word: "science",
					pronunciations: [
						{ accent: "uk", label: "英", phonetic: "saɪəns", audioUrl: null },
					],
					sourceId: "youdao",
					sourceLabel: "有道词典",
					suggestions: [],
					sections: [
						{
							title: "释义",
							presentation: "stack",
							content: { kind: "list", items: ["科学"] },
						},
						{
							title: "HTML",
							presentation: "tab",
							content: { kind: "document", document },
						},
					],
				},
			},
		];
		const { adapter } = setup(state);

		const snapshot = adapter.startLookup("science", ["youdao"])?.getSnapshot();

		expect(snapshot?.sources[0]).toMatchObject({
			id: "youdao",
			pronunciations: [{ label: "英", phonetic: "saɪəns" }],
			sections: [
				{ kind: "list", items: ["科学"], title: "释义", presentation: "stack" },
				{ kind: "embedded", handle: document, title: "HTML", presentation: "tab" },
			],
			activeSectionIndex: 1,
		});
		const section = snapshot?.sources[0]?.sections[1];
		expect(section?.kind === "embedded" && section.handle).toBe(document);
		expect(JSON.stringify(snapshot)).not.toContain("private HTML");
	});

	it("forwards semantic actions and disposes the isolated query session", async () => {
		const { adapter, spies } = setup(emptyDictionarySnapshot());
		const session = adapter.startLookup("science", ["youdao"])!;

		session.selectSource("youdao");
		await session.retry("youdao");
		await session.generateAi();
		session.selectSection("youdao", 2);
		await session.lookup("world");
		session.dispose();

		expect(spies.send).toHaveBeenNthCalledWith(1, {
			type: "select-source",
			sourceId: "youdao",
		});
		expect(spies.send).toHaveBeenNthCalledWith(2, {
			type: "retry-source",
			sourceId: "youdao",
		});
		expect(spies.send).toHaveBeenNthCalledWith(3, { type: "generate-ai" });
		expect(spies.send).toHaveBeenNthCalledWith(4, {
			type: "select-section",
			sourceId: "youdao",
			sectionIndex: 2,
		});
		expect(spies.send).toHaveBeenNthCalledWith(5, { type: "lookup", query: "world" });
		expect(spies.dispose).toHaveBeenCalledOnce();
	});
});

function setup(state: DictionaryViewState) {
	const spies = {
		send: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn(),
	};
	const session: DictionaryQuerySession = {
		getSnapshot: () => state,
		subscribe: () => () => {},
		send: spies.send,
		dispose: spies.dispose,
	};
	const runtime = {
		settings: {
			getDictionarySettings: () => ({
				...structuredClone(DEFAULT_DICTIONARY_SETTINGS),
				sources: [
					{ id: "youdao", kind: "youdao" as const, label: "有道词典", enabled: true },
					{ id: "off", kind: "hujiang" as const, label: "沪江", enabled: false },
					{ id: "ai", kind: "ai" as const, label: "AI 词典", enabled: true },
					{ id: "local", kind: "local" as const, label: "OALD", enabled: true },
				],
			}),
		},
		createSelectionLookupSession: vi.fn(() => session),
	};
	return {
		spies,
		adapter: createDictionarySelectionAdapter({
			runtime: () => runtime,
			openInMainTab: vi.fn().mockResolvedValue(undefined),
		}),
	};
}

function emptyDictionarySnapshot(): DictionaryViewState {
	return {
		activeSourceId: null,
		aiEngineName: "",
		aiReady: false,
		history: [],
		input: "science",
		query: "science",
		sources: [],
		status: "loading",
	};
}
