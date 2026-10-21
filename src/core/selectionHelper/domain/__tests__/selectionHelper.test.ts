import { describe, expect, it, vi } from "vite-plus/test";
import { SelectionHelper } from "../selectionHelper";
import type {
	SelectionCandidate,
	SelectionDictionaryAdapter,
	SelectionHelperSettings,
	SelectionLookupHandle,
	SelectionLookupIntent,
	SelectionLookupSnapshot,
	SelectionTranslationAdapter,
} from "../types";

describe("SelectionHelper", () => {
	it("explicitly opens a blank card despite disabled automatic capture and only queries on submission", () => {
		const settings: SelectionHelperSettings = {
			enabled: false,
			modifier: "alt",
			openMainShortcut: "Ctrl+Enter",
			dictionaryOrder: [],
			selectedDictionaries: [],
		};
		const startLookup = vi.fn(() => fakeHandle().handle);
		const { helper } = setup({ settings, startLookup });
		const source = helper.openSource({});
		const pending = source.capture();
		helper.openDictionary(source.reference);
		expect(helper.getSnapshot()).toMatchObject({
			visible: true,
			mode: "dictionary",
			target: { text: "", trigger: "manual" },
		});
		expect(startLookup).not.toHaveBeenCalled();
		expect(pending.submit(candidate("late"))).toBe(false);
		helper.refresh();
		expect(helper.getSnapshot().visible).toBe(true);
		helper.lookup("  hello   world  ");
		expect(startLookup).toHaveBeenCalledWith("hello world", ["a", "b"]);
		source.dispose();
		expect(helper.getSnapshot().visible).toBe(false);
	});

	it("preserves the open card without a new valid selection and replaces its session for new words", () => {
		const first = fakeHandle();
		const startLookup = vi.fn(() => first.handle);
		const { helper } = setup({ startLookup });
		const source = helper.openSource({});
		helper.openDictionary(source.reference, { text: "first", x: 4, y: 8 });
		const snapshot = helper.getSnapshot();
		helper.openDictionary(source.reference, { text: "不是英文", x: 0, y: 0 });
		expect(helper.getSnapshot()).toBe(snapshot);
		helper.openDictionary(source.reference);
		expect(helper.getSnapshot()).toBe(snapshot);
		helper.openDictionary(source.reference, { text: "second", x: 9, y: 8 });
		expect(first.dispose).toHaveBeenCalledOnce();
		expect(startLookup).toHaveBeenLastCalledWith("second", ["a", "b"]);
		expect(helper.getSnapshot().target?.text).toBe("second");
	});

	it("keeps manual lookup visible when no dictionary source is available", () => {
		const { helper, dictionary } = setup();
		dictionary.sources = () => [];
		const start = vi.spyOn(dictionary, "startLookup");
		const source = helper.openSource({});
		helper.openDictionary(source.reference, { text: "hello", x: 1, y: 2 });
		expect(helper.getSnapshot()).toMatchObject({
			visible: true,
			mode: "dictionary",
			lookup: { query: "hello", sources: [] },
		});
		helper.lookup("world");
		expect(start).not.toHaveBeenCalled();
		expect(helper.getSnapshot().lookup?.query).toBe("world");
		helper.dismiss();
		helper.openDictionary(source.reference);
		expect(helper.getSnapshot().target?.text).toBe("");
		source.dispose();
		helper.openDictionary(source.reference);
		expect(helper.getSnapshot().visible).toBe(false);
	});

	it.each([
		{ selectedDictionaries: [] },
		{ selectedDictionaries: ["a"] },
		{ selectedDictionaries: ["a", "b"] },
	])("looks up selected dictionaries in popup order (%j)", ({ selectedDictionaries }) => {
		const startLookup = vi.fn(() => fakeHandle().handle);
		const { helper } = setup({
			settings: {
				enabled: true,
				modifier: "none",
				openMainShortcut: "Ctrl+Enter",
				selectedDictionaries,
				dictionaryOrder: ["b", "missing", "b", "a"],
			},
			startLookup,
		});
		select(helper, candidate("hello"));
		helper.beginLookup();
		expect(startLookup).toHaveBeenCalledWith(
			"hello",
			selectedDictionaries.length === 1 ? ["a"] : ["b", "a"],
		);
		helper.dispose();
	});

	it("ignores desktop modifier for touch and invalidates only the destroyed source", () => {
		const { helper } = setup({
			settings: {
				enabled: true,
				modifier: "alt",
				openMainShortcut: "Ctrl+Enter",
				dictionaryOrder: [],
				selectedDictionaries: [],
			},
		});
		const first = helper.openSource({});
		first.capture().submit(candidate("touch", { trigger: "touch" }));
		expect(helper.getSnapshot().visible).toBe(true);
		const late = first.capture();
		first.dispose();
		expect(late.submit(candidate("late", { trigger: "touch" }))).toBe(false);
		expect(helper.getSnapshot().visible).toBe(false);
		const next = helper.openSource({});
		next.capture().submit(candidate("next", { trigger: "touch" }));
		first.dismiss();
		first.dispose();
		expect(helper.getSnapshot().target?.text).toBe("next");
	});

	it("filters selected sources in catalog order and owns the lookup lifetime", () => {
		const { handle: session, dispose } = fakeHandle();
		const startLookup = vi.fn(() => session);
		const { helper } = setup({
			settings: {
				enabled: true,
				modifier: "none",
				openMainShortcut: "Ctrl+Enter",
				dictionaryOrder: [],
				selectedDictionaries: ["b", "a"],
			},
			startLookup,
		});

		select(helper, candidate("hello world"));
		expect(helper.getSnapshot()).toMatchObject({
			visible: true,
			mode: "actions",
			canLookup: true,
			canTranslate: true,
		});

		helper.beginLookup();
		expect(startLookup).toHaveBeenCalledWith("hello world", ["a", "b"]);
		expect(helper.getSnapshot().mode).toBe("dictionary");

		helper.dismiss();
		expect(dispose).toHaveBeenCalledOnce();
		expect(helper.getSnapshot().visible).toBe(false);
	});

	it("keeps stale explicit source ids without falling back to all sources", () => {
		const startLookup = vi.fn();
		const { helper } = setup({
			settings: {
				enabled: true,
				modifier: "none",
				openMainShortcut: "Ctrl+Enter",
				dictionaryOrder: [],
				selectedDictionaries: ["missing"],
			},
			startLookup,
		});

		select(helper, candidate("hello"));

		expect(helper.getSnapshot().canLookup).toBe(false);
		helper.beginLookup();
		expect(startLookup).not.toHaveBeenCalled();
	});

	it("replaces the previous selection session and discards later updates", () => {
		const { handle: session, dispose } = fakeHandle();
		const { helper } = setup({ startLookup: () => session });
		select(helper, candidate("first"));
		helper.beginLookup();

		select(helper, candidate("second"));

		expect(dispose).toHaveBeenCalledOnce();
		expect(helper.getSnapshot().target?.text).toBe("second");
		expect(helper.getSnapshot().lookup).toBeNull();
	});
	it("preserves an open lookup when its source reports the same selection again", () => {
		const { handle: session, dispose } = fakeHandle();
		const { helper } = setup({ startLookup: () => session });
		const source = helper.openSource({});
		source.capture().submit(candidate("hello"));
		helper.beginLookup();
		expect(source.capture().submit(candidate(""))).toBe(false);
		expect(source.capture().submit(candidate("hello"))).toBe(false);
		expect(helper.getSnapshot()).toMatchObject({ visible: true, mode: "dictionary" });
		expect(dispose).not.toHaveBeenCalled();

		expect(source.capture().submit(candidate("hello", { x: 30 }))).toBe(true);
		expect(helper.getSnapshot()).toMatchObject({
			visible: true,
			mode: "actions",
			target: { x: 30 },
		});
		expect(dispose).toHaveBeenCalledOnce();
	});

	it("closes before handing text to the translation adapter", async () => {
		const openPrefilled = vi.fn().mockResolvedValue(undefined);
		const { helper } = setup({ openPrefilled });
		select(helper, candidate("一段中文"));

		await helper.translate();

		expect(helper.getSnapshot().visible).toBe(false);
		expect(openPrefilled).toHaveBeenCalledWith("一段中文");
	});

	it("honors the configured modifier and eligible note context", () => {
		const { helper } = setup({
			settings: {
				enabled: true,
				modifier: "alt",
				openMainShortcut: "Ctrl+Enter",
				dictionaryOrder: [],
				selectedDictionaries: [],
			},
		});
		select(helper, candidate("hello", { altKey: false }));
		expect(helper.getSnapshot().visible).toBe(false);
		select(helper, candidate("hello", { altKey: true, eligibleContext: false }));
		expect(helper.getSnapshot().visible).toBe(false);
		select(helper, candidate("hello", { altKey: true }));
		expect(helper.getSnapshot().visible).toBe(true);
	});

	it("owns lookup actions and clears the handle upon dismissal", async () => {
		const fake = fakeHandle();
		const startLookup = vi.fn(() => fake.handle);
		const { helper } = setup({ startLookup });
		select(helper, candidate("hello"));
		expect("session" in helper.getSnapshot()).toBe(false);

		helper.beginLookup();
		expect(startLookup).toHaveBeenCalledTimes(1);
		helper.selectSource("b");
		helper.selectSection("b", 2);
		helper.lookup("world");
		expect(fake.intents).toEqual([
			{ type: "select-source", sourceId: "b" },
			{ type: "select-section", sourceId: "b", sectionIndex: 2 },
			{ type: "lookup", query: "world" },
		]);
		expect(helper.getSnapshot()).toMatchObject({ visible: true, mode: "dictionary" });

		helper.dismiss();
		expect(fake.dispose).toHaveBeenCalledOnce();
		expect(helper.getSnapshot().lookup).toBeNull();
	});

	it("routes retry by the active source kind", async () => {
		const fake = fakeHandle();
		const { helper } = setup({ startLookup: () => fake.handle });
		select(helper, candidate("hello"));
		helper.beginLookup();

		await helper.retryActiveSource();
		expect(fake.intents[fake.intents.length - 1]).toEqual({
			type: "retry-source",
			sourceId: "dictionary",
		});

		fake.setSnapshot({ activeSourceId: "ai" });
		await helper.retryActiveSource();
		expect(fake.intents[fake.intents.length - 1]).toEqual({ type: "generate-ai" });
	});

	it("ignores late handle notifications after dismissal", () => {
		const fake = fakeHandle();
		let notify!: () => void;
		fake.handle.subscribe = (listener) => {
			notify = listener;
			return vi.fn();
		};
		const { helper } = setup({ startLookup: () => fake.handle });
		select(helper, candidate("hello"));
		helper.beginLookup();
		helper.dismiss();
		notify();
		expect(helper.getSnapshot()).toMatchObject({ visible: false, lookup: null });
	});
	it("opens favorite form for query, dismisses popup, and reflects canFavorite capability", async () => {
		const openFavorite = vi.fn().mockResolvedValue(undefined);
		const { helper } = setup({ openFavorite });

		expect(helper.canFavorite).toBe(true);

		select(helper, candidate("commercial"));
		helper.beginLookup();

		await helper.openFavorite("commercial");

		expect(openFavorite).toHaveBeenCalledWith("commercial");
		expect(helper.getSnapshot().visible).toBe(false);
	});

	it("reflects canFavorite as false when openFavorite is not implemented", () => {
		const { helper } = setup({ openFavorite: undefined });
		expect(helper.canFavorite).toBe(false);
	});

	it("rejects another window's pending capture after a newer selection without expiring its source", () => {
		const { helper } = setup();
		const first = helper.openSource({});
		const second = helper.openSource({});
		const pending = first.capture();
		second.capture().submit(candidate("new selection"));
		expect(pending.isCurrent()).toBe(false);
		expect(pending.submit(candidate("old result"))).toBe(false);
		expect(helper.getSnapshot().target?.text).toBe("new selection");
		expect(first.active).toBe(true);
		first.capture().submit(candidate("fresh selection"));
		expect(helper.getSnapshot().target?.text).toBe("fresh selection");
	});

	it("fences pending work when dismissed even if no popup is visible", () => {
		const { helper } = setup();
		const source = helper.openSource({});
		const pending = source.capture();
		helper.dismiss();
		expect(pending.submit(candidate("late"))).toBe(false);
		expect(helper.getSnapshot().visible).toBe(false);
		source.capture().submit(candidate("new"));
		expect(helper.getSnapshot().target?.text).toBe("new");
	});

	it("host interaction fences old reads without releasing the visible lookup", () => {
		const { handle: session, dispose } = fakeHandle();
		const { helper } = setup({ startLookup: () => session });
		const source = helper.openSource({});
		source.capture().submit(candidate("hello"));
		helper.beginLookup();
		const pending = source.capture();
		helper.interrupt();
		pending.dismiss();
		expect(pending.submit(candidate("old"))).toBe(false);
		expect(dispose).not.toHaveBeenCalled();
		expect(helper.getSnapshot().mode).toBe("dictionary");
	});

	it("owner-scoped closing fences all pending captures but preserves another window's visible query", () => {
		const { helper } = setup();
		const owner = {};
		const source = helper.openSource(owner);
		const other = helper.openSource({});
		other.capture().submit(candidate("other window"));
		const ownPending = source.capture();
		const otherPending = other.capture();
		helper.dismiss(owner);
		expect(ownPending.isCurrent()).toBe(false);
		expect(otherPending.isCurrent()).toBe(false);
		expect(helper.getSnapshot().target?.text).toBe("other window");
		other.capture().submit(candidate("new other window"));
		expect(helper.ownsSource(owner, helper.getSnapshot().target?.source)).toBe(false);
		source.capture().submit(candidate("owned"));
		expect(helper.ownsSource(owner, helper.getSnapshot().target?.source)).toBe(true);
		helper.dismiss(owner);
		expect(helper.getSnapshot().visible).toBe(false);
	});

	it("retires the exact page without dismissing its replacement or keeping it registered", () => {
		const { helper } = setup();
		const owner = {};
		const page = helper.openSource(owner);
		page.capture().submit(candidate("old page"));
		const oldRead = page.capture();
		page.dispose();
		const nextPage = helper.openSource(owner);
		nextPage.capture().submit(candidate("new page"));
		oldRead.dismiss();
		page.dismiss();
		page.dispose();
		expect(page.active).toBe(false);
		expect(oldRead.submit(candidate("late page"))).toBe(false);
		expect(helper.ownsSource(owner, page.reference)).toBe(false);
		expect(helper.ownsSource(owner, nextPage.reference)).toBe(true);
		expect(helper.getSnapshot().target?.source).toBe(nextPage.reference);
	});

	it("releases a disappearing selection's query but accepts a fresh selection from the same source", () => {
		const { handle: session, dispose } = fakeHandle();
		const { helper } = setup({ startLookup: () => session });
		const source = helper.openSource({});
		source.capture().submit(candidate("hello"));
		helper.beginLookup();
		const pending = source.capture();
		source.dismiss();
		expect(dispose).toHaveBeenCalledOnce();
		expect(pending.isCurrent()).toBe(false);
		expect(source.active).toBe(true);
		source.capture().submit(candidate("next"));
		expect(helper.getSnapshot().target?.text).toBe("next");
	});

	it("keeps the captured text and consumes each read once", () => {
		const { helper } = setup();
		const source = helper.openSource({});
		const read = source.capture();
		const value = candidate("hello");
		expect(read.submit(value)).toBe(true);
		value.text = "edited in place";
		expect(helper.getSnapshot().target?.text).toBe("hello");
		expect(read.submit(candidate("replayed"))).toBe(false);
		read.dismiss();
		expect(helper.getSnapshot().target?.text).toBe("hello");
	});

	it("expires all leases on disposal and never reactivates a stopped helper", () => {
		const { helper } = setup();
		const source = helper.openSource({});
		const pending = source.capture();
		helper.dispose();
		helper.dispose();
		expect(source.active).toBe(false);
		expect(pending.submit(candidate("late"))).toBe(false);
		const afterStop = helper.openSource({});
		expect(afterStop.active).toBe(false);
		expect(afterStop.capture().submit(candidate("after stop"))).toBe(false);
		expect(helper.getSnapshot().visible).toBe(false);
	});

	it.each(["translate", "openDictionaryInMainTab", "openFavorite"] as const)(
		"allows accepted %s handoffs to finish after their source closes",
		async (action) => {
			let finish!: () => void;
			const complete = new Promise<void>((resolve) => {
				finish = resolve;
			});
			const { helper, dictionary, translation } = setup();
			const invoke = vi.fn(() => complete);
			if (action === "translate") translation.openPrefilled = invoke;
			else if (action === "openFavorite") dictionary.openFavorite = invoke;
			else dictionary.openInMainTab = invoke;
			const source = helper.openSource({});
			source.capture().submit(candidate("hello"));
			const handoff = helper[action]();
			expect(invoke).toHaveBeenCalledWith("hello");
			source.dispose();
			helper.openSource({}).capture().submit(candidate("new selection"));
			finish();
			await handoff;
			expect(helper.getSnapshot().target?.text).toBe("new selection");
		},
	);
});

function setup(
	overrides: {
		settings?: SelectionHelperSettings;
		startLookup?: SelectionDictionaryAdapter["startLookup"];
		openPrefilled?: SelectionTranslationAdapter["openPrefilled"];
		openFavorite?: SelectionDictionaryAdapter["openFavorite"];
	} = {},
) {
	const settings =
		overrides.settings ??
		({
			enabled: true,
			modifier: "none",
			openMainShortcut: "Ctrl+Enter",
			dictionaryOrder: [],
			selectedDictionaries: [],
		} satisfies SelectionHelperSettings);
	const dictionary: SelectionDictionaryAdapter = {
		sources: () => [
			{ id: "a", label: "A", kind: "dictionary" },
			{ id: "b", label: "B", kind: "ai" },
		],
		startLookup: overrides.startLookup ?? (() => fakeHandle().handle),
		openInMainTab: vi.fn().mockResolvedValue(undefined),
		openFavorite:
			"openFavorite" in overrides
				? overrides.openFavorite
				: vi.fn().mockResolvedValue(undefined),
	};
	const translation: SelectionTranslationAdapter = {
		available: () => true,
		openPrefilled: overrides.openPrefilled ?? vi.fn().mockResolvedValue(undefined),
	};
	return {
		helper: new SelectionHelper({ settings: () => settings, dictionary, translation }),
		dictionary,
		translation,
	};
}

function candidate(text: string, overrides: Partial<SelectionCandidate> = {}) {
	return {
		text,
		x: 10,
		y: 20,
		eligibleContext: true,
		altKey: false,
		shiftKey: false,
		ctrlOrMetaKey: false,
		...overrides,
	};
}

function fakeHandle(): {
	handle: SelectionLookupHandle;
	dispose: ReturnType<typeof vi.fn>;
	intents: SelectionLookupIntent[];
	setSnapshot(next: Partial<SelectionLookupSnapshot>): void;
} {
	let snapshot: SelectionLookupSnapshot = {
		query: "hello",
		activeSourceId: "dictionary",
		aiEngineName: "",
		status: "loading",
		sources: [
			{
				id: "dictionary",
				label: "Dictionary",
				kind: "dictionary",
				status: "loading",
				error: "",
				pronunciations: [],
				result: null,
			},
			{
				id: "ai",
				label: "AI",
				kind: "ai",
				status: "idle",
				error: "",
				pronunciations: [],
				result: null,
			},
		],
	};
	const listeners = new Set<() => void>();
	const intents: SelectionLookupIntent[] = [];
	const dispose = vi.fn();
	return {
		intents,
		dispose,
		handle: {
			getSnapshot: () => snapshot,
			subscribe: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			send: vi.fn(async (intent: SelectionLookupIntent) => {
				intents.push(intent);
			}),
			dispose,
		},
		setSnapshot(next) {
			snapshot = { ...snapshot, ...next };
			for (const listener of listeners) listener();
		},
	};
}

function select(helper: SelectionHelper, value: SelectionCandidate): boolean {
	return helper.openSource({}).capture().submit(value);
}
