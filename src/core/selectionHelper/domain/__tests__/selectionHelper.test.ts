import { describe, expect, it, vi } from "vite-plus/test";
import { SelectionHelper } from "../selectionHelper";
import type {
	SelectionCandidate,
	SelectionDictionaryAdapter,
	SelectionHelperSettings,
	SelectionLookupSession,
	SelectionLookupSnapshot,
	SelectionTranslationAdapter,
} from "../types";

describe("SelectionHelper", () => {
	it.each([
		{ selectedDictionaries: [] },
		{ selectedDictionaries: ["a"] },
		{ selectedDictionaries: ["a", "b"] },
	])("looks up selected dictionaries in popup order (%j)", ({ selectedDictionaries }) => {
		const startLookup = vi.fn(() => fakeSession().session);
		const { helper } = setup({
			settings: {
				enabled: true,
				modifier: "none",
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
		const { session, dispose } = fakeSession();
		const startLookup = vi.fn(() => session);
		const { helper } = setup({
			settings: {
				enabled: true,
				modifier: "none",
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
		const { session, dispose } = fakeSession();
		const { helper } = setup({ startLookup: () => session });
		select(helper, candidate("first"));
		helper.beginLookup();

		select(helper, candidate("second"));

		expect(dispose).toHaveBeenCalledOnce();
		expect(helper.getSnapshot().target?.text).toBe("second");
		expect(helper.getSnapshot().lookup).toBeNull();
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

	it("keeps the isolated session for entry navigation and chapter selection", async () => {
		const { session, actions } = fakeSession();
		const startLookup = vi.fn(() => session);
		const { helper } = setup({ startLookup });
		select(helper, candidate("hello"));
		helper.beginLookup();
		helper.selectSource("b");
		helper.selectSection("b", 2);
		await helper.lookup("world");
		expect(startLookup).toHaveBeenCalledTimes(1);
		expect(actions.selectSource).toHaveBeenCalledWith("b");
		expect(actions.selectSection).toHaveBeenCalledWith("b", 2);
		expect(actions.lookup).toHaveBeenCalledWith("world");
		expect(helper.getSnapshot()).toMatchObject({ visible: true, mode: "dictionary" });
		helper.dismiss();
		await helper.lookup("later");
		expect(actions.lookup).toHaveBeenCalledTimes(1);
	});

	it("ignores late session notifications after dismissal", () => {
		const { session } = fakeSession();
		let notify!: () => void;
		session.subscribe = (listener) => {
			notify = listener;
			return vi.fn();
		};
		const { helper } = setup({ startLookup: () => session });
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
		const { session, dispose } = fakeSession();
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
		const { session, dispose } = fakeSession();
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
			dictionaryOrder: [],
			selectedDictionaries: [],
		} satisfies SelectionHelperSettings);
	const dictionary: SelectionDictionaryAdapter = {
		sources: () => [
			{ id: "a", label: "A", kind: "dictionary" },
			{ id: "b", label: "B", kind: "ai" },
		],
		startLookup: overrides.startLookup ?? (() => fakeSession().session),
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

function fakeSession(): {
	session: SelectionLookupSession;
	dispose: ReturnType<typeof vi.fn>;
	actions: {
		selectSource: ReturnType<typeof vi.fn>;
		selectSection: ReturnType<typeof vi.fn>;
		lookup: ReturnType<typeof vi.fn>;
	};
} {
	const snapshot: SelectionLookupSnapshot = {
		query: "hello",
		activeSourceId: "a",
		aiEngineName: "",
		status: "loading",
		sources: [],
	};
	const dispose = vi.fn();
	const actions = {
		selectSource: vi.fn(),
		selectSection: vi.fn(),
		lookup: vi.fn().mockResolvedValue(undefined),
	};
	return {
		actions,
		dispose,
		session: {
			getSnapshot: () => snapshot,
			subscribe: () => () => {},
			...actions,
			retry: vi.fn().mockResolvedValue(undefined),
			generateAi: vi.fn().mockResolvedValue(undefined),
			dispose,
		},
	};
}

function select(helper: SelectionHelper, value: SelectionCandidate): boolean {
	return helper.openSource({}).capture().submit(value);
}
