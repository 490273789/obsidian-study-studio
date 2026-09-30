import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DICTIONARY_SETTINGS } from "../configuration";
import { createDictionaryQuerySession } from "../querySession";
import {
	DictionaryError,
	type DictionaryResult,
	type DictionarySettings,
	type DictionarySettingsStore,
	type DictionarySource,
} from "../types";

describe("dictionary query session", () => {
	it("retires the old entry before history saves, preserves the chosen source, and resets chapters", async () => {
		const settings = dictionarySettings([
			{ enabled: true, id: "first", kind: "local", label: "First" },
			{ enabled: true, id: "oald", kind: "local", label: "OALD" },
			{ enabled: true, id: "ai", kind: "ai", label: "AI" },
		]);
		const session = createDictionaryQuerySession({
			settings: settings.store,
			resolveSource: (source) =>
				dictionarySource(source.id, source.kind, source.label, async (word) => {
					if (word === "missing") throw new DictionaryError("not-found", "No entry");
					return {
						...result(source.id, source.label, word),
						sections: [
							{
								title: "Definition",
								presentation: "tab",
								content: { kind: "list", items: [word] },
							},
							{
								title: "Examples",
								presentation: "tab",
								content: { kind: "list", items: [] },
							},
						],
					};
				}),
			notify: vi.fn(),
			aiEngineInfo: () => ({ configId: null, name: null }),
		});
		await session.send({ type: "lookup", query: "segmenting" });
		await session.send({ type: "select-source", sourceId: "oald" });
		await session.send({ type: "select-section", sourceId: "oald", sectionIndex: 1 });
		const historySave = deferred<boolean>();
		const save = settings.store.updateDictionarySettings.bind(settings.store);
		settings.store.updateDictionarySettings = async (mutate) => {
			await historySave.promise;
			return save(mutate);
		};
		const navigation = session.send({ type: "lookup", query: "segment" });
		expect(session.getSnapshot()).toMatchObject({
			query: "segment",
			activeSourceId: "oald",
			status: "loading",
		});
		expect(
			session
				.getSnapshot()
				.sources.every(
					(source) => source.result === null && source.activeSectionIndex === null,
				),
		).toBe(true);
		historySave.resolve(true);
		await navigation;
		expect(session.getSnapshot().activeSourceId).toBe("oald");
		expect(session.getSnapshot().sources[1]).toMatchObject({
			activeSectionIndex: 0,
			result: { word: "segment" },
		});
		expect(settings.current().history.slice(0, 2)).toEqual(["segment", "segmenting"]);
		expect(session.getSnapshot().sources[2]?.status).toBe("idle");
		await session.send({ type: "lookup", query: "missing" });
		expect(session.getSnapshot().activeSourceId).toBe("oald");
		expect(session.getSnapshot().sources[1]?.status).toBe("empty");
	});

	it("does not publish a lookup that completes after the session is disposed", async () => {
		const settings = dictionarySettings([
			{ enabled: true, id: "oald", kind: "local", label: "OALD" },
		]);
		const pending = deferred<DictionaryResult>();
		const source = dictionarySource("oald", "local", "OALD", () => pending.promise);
		const session = createDictionaryQuerySession({
			settings: settings.store,
			resolveSource: () => source,
			notify: vi.fn(),
			aiEngineInfo: () => ({ configId: null, name: null }),
		});
		const notification = vi.fn();
		session.subscribe(notification);
		const lookup = session.send({ type: "lookup", query: "segment" });
		await vi.waitFor(() => expect(session.getSnapshot().sources[0]?.status).toBe("loading"));
		session.dispose();
		const count = notification.mock.calls.length;
		pending.resolve(result("oald", "OALD", "segment"));
		await lookup;
		expect(notification).toHaveBeenCalledTimes(count);
	});
	it("owns lookup ordering, history, independent source failures, and explicit AI generation", async () => {
		const settings = dictionarySettings([
			{ enabled: true, id: "youdao", kind: "youdao", label: "有道" },
			{ enabled: true, id: "hujiang", kind: "hujiang", label: "沪江" },
			{ enabled: true, id: "ai", kind: "ai", label: "AI" },
		]);
		const lookups: string[] = [];
		const session = createDictionaryQuerySession({
			settings: settings.store,
			resolveSource: (source) =>
				dictionarySource(source.id, source.kind, source.label, async (query) => {
					lookups.push(`${source.id}:${query}`);
					if (source.id === "hujiang") {
						throw new DictionaryError("not-found", "没有找到");
					}
					return result(source.id, source.label, query);
				}),
			notify: vi.fn(),
			aiEngineInfo: () => ({ configId: "engine", name: "释义引擎" }),
		});

		await session.send({ type: "lookup", query: "  Science   fiction  " });

		expect(settings.current().history[0]).toBe("Science fiction");
		expect(lookups).toEqual(["youdao:Science fiction", "hujiang:Science fiction"]);
		expect(session.getSnapshot()).toMatchObject({
			query: "Science fiction",
			status: "ready",
			activeSourceId: "youdao",
			sources: [
				{ id: "youdao", status: "success" },
				{ id: "hujiang", status: "empty", error: "没有找到" },
				{ id: "ai", status: "idle" },
			],
		});

		await session.send({ type: "generate-ai" });

		expect(lookups).toContain("ai:Science fiction");
		expect(session.getSnapshot().sources[2]?.status).toBe("success");
	});

	it("discards an older source result after a newer lookup starts", async () => {
		const settings = dictionarySettings([
			{ enabled: true, id: "youdao", kind: "youdao", label: "有道" },
		]);
		const pending = new Map<string, ReturnType<typeof deferred<DictionaryResult>>>();
		const session = createDictionaryQuerySession({
			settings: settings.store,
			resolveSource: (source) =>
				dictionarySource(source.id, source.kind, source.label, (query) => {
					const request = deferred<DictionaryResult>();
					pending.set(query, request);
					return request.promise;
				}),
			notify: vi.fn(),
			aiEngineInfo: () => ({ configId: null, name: null }),
		});

		const first = session.send({ type: "lookup", query: "first" });
		await vi.waitFor(() => expect(pending.has("first")).toBe(true));
		const second = session.send({ type: "lookup", query: "second" });
		await vi.waitFor(() => expect(pending.has("second")).toBe(true));

		pending.get("second")?.resolve(result("youdao", "有道", "second"));
		await second;
		pending.get("first")?.resolve(result("youdao", "有道", "first"));
		await first;

		expect(session.getSnapshot().query).toBe("second");
		expect(session.getSnapshot().sources[0]?.result?.word).toBe("second");
	});

	it("publishes immutable snapshots and handles presentation selection through intents", async () => {
		const settings = dictionarySettings([
			{ enabled: true, id: "youdao", kind: "youdao", label: "有道" },
		]);
		const session = createDictionaryQuerySession({
			settings: settings.store,
			resolveSource: (source) =>
				dictionarySource(source.id, source.kind, source.label, async (query) => ({
					...result(source.id, source.label, query),
					sections: [
						{
							title: "概要",
							presentation: "stack",
							content: { kind: "list", items: [] },
						},
						{
							title: "英英",
							presentation: "tab",
							content: { kind: "list", items: [] },
						},
						{
							title: "例句",
							presentation: "tab",
							content: { kind: "list", items: [] },
						},
					],
				})),
			notify: vi.fn(),
			aiEngineInfo: () => ({ configId: null, name: null }),
		});

		await session.send({ type: "lookup", query: "word" });
		await session.send({
			type: "select-section",
			sourceId: "youdao",
			sectionIndex: 2,
		});

		const snapshot = session.getSnapshot();
		expect(snapshot.sources[0]?.activeSectionIndex).toBe(2);
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.sources)).toBe(true);

		await session.send({ type: "clear" });
		expect(session.getSnapshot()).toMatchObject({ query: "", sources: [], status: "idle" });
	});
});

function dictionarySettings(sources: DictionarySettings["sources"]): {
	store: DictionarySettingsStore;
	current(): DictionarySettings;
} {
	let current = { ...structuredClone(DEFAULT_DICTIONARY_SETTINGS), sources };
	const store: DictionarySettingsStore = {
		getDictionarySettings: () => current,
		updateDictionarySettings: async (mutate) => {
			const draft = structuredClone(current);
			mutate(draft);
			current = draft;
			return true;
		},
		getLocalDictionaryAdministrationState: () => current,
		setLocalDictionaryAdministrationState: (state) => {
			current = { ...current, ...state };
		},
		save: async () => {},
	};
	return { store, current: () => current };
}

function dictionarySource(
	id: string,
	kind: DictionarySource["kind"],
	label: string,
	lookup: (query: string) => Promise<DictionaryResult>,
): DictionarySource {
	return { id, kind, label, lookup: ({ text }) => lookup(text) };
}

function result(sourceId: string, sourceLabel: string, word: string): DictionaryResult {
	return {
		attribution: "",
		pronunciations: [],
		sections: [],
		sourceId,
		sourceLabel,
		suggestions: [],
		word,
	};
}

function deferred<T>(): {
	promise: Promise<T>;
	resolve(value: T): void;
} {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
