import { describe, expect, it, vi } from "vitest";
import { SelectionHelper } from "../selectionHelper";
import type {
	SelectionDictionaryAdapter,
	SelectionHelperSettings,
	SelectionLookupSession,
	SelectionLookupSnapshot,
	SelectionTranslationAdapter,
} from "../types";

describe("SelectionHelper", () => {
	it("filters selected sources in catalog order and owns the lookup lifetime", () => {
		const { session, dispose } = fakeSession();
		const startLookup = vi.fn(() => session);
		const { helper } = setup({
			settings: { enabled: true, modifier: "none", selectedDictionaries: ["b", "a"] },
			startLookup,
		});

		helper.handleSelection(candidate("hello world"));
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
			settings: { enabled: true, modifier: "none", selectedDictionaries: ["missing"] },
			startLookup,
		});

		helper.handleSelection(candidate("hello"));

		expect(helper.getSnapshot().canLookup).toBe(false);
		helper.beginLookup();
		expect(startLookup).not.toHaveBeenCalled();
	});

	it("replaces the previous selection session and discards later updates", () => {
		const { session, dispose } = fakeSession();
		const { helper } = setup({ startLookup: () => session });
		helper.handleSelection(candidate("first"));
		helper.beginLookup();

		helper.handleSelection(candidate("second"));

		expect(dispose).toHaveBeenCalledOnce();
		expect(helper.getSnapshot().target?.text).toBe("second");
		expect(helper.getSnapshot().lookup).toBeNull();
	});

	it("closes before handing text to the translation adapter", async () => {
		const openPrefilled = vi.fn().mockResolvedValue(undefined);
		const { helper } = setup({ openPrefilled });
		helper.handleSelection(candidate("一段中文"));

		await helper.translate();

		expect(helper.getSnapshot().visible).toBe(false);
		expect(openPrefilled).toHaveBeenCalledWith("一段中文");
	});

	it("honors the configured modifier and eligible note context", () => {
		const { helper } = setup({
			settings: { enabled: true, modifier: "alt", selectedDictionaries: [] },
		});
		helper.handleSelection(candidate("hello", { altKey: false }));
		expect(helper.getSnapshot().visible).toBe(false);
		helper.handleSelection(candidate("hello", { altKey: true, eligibleContext: false }));
		expect(helper.getSnapshot().visible).toBe(false);
		helper.handleSelection(candidate("hello", { altKey: true }));
		expect(helper.getSnapshot().visible).toBe(true);
	});

	it("keeps the isolated session for entry navigation and chapter selection", async () => {
		const { session, actions } = fakeSession();
		const startLookup = vi.fn(() => session);
		const { helper } = setup({ startLookup });
		helper.handleSelection(candidate("hello"));
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
		helper.handleSelection(candidate("hello"));
		helper.beginLookup();
		helper.dismiss();
		notify();
		expect(helper.getSnapshot()).toMatchObject({ visible: false, lookup: null });
	});
});

function setup(
	overrides: {
		settings?: SelectionHelperSettings;
		startLookup?: SelectionDictionaryAdapter["startLookup"];
		openPrefilled?: SelectionTranslationAdapter["openPrefilled"];
	} = {},
) {
	const settings =
		overrides.settings ??
		({
			enabled: true,
			modifier: "none",
			selectedDictionaries: [],
		} satisfies SelectionHelperSettings);
	const dictionary: SelectionDictionaryAdapter = {
		sources: () => [
			{ id: "a", label: "A", kind: "dictionary" },
			{ id: "b", label: "B", kind: "ai" },
		],
		startLookup: overrides.startLookup ?? (() => fakeSession().session),
		openInMainTab: vi.fn().mockResolvedValue(undefined),
	};
	const translation: SelectionTranslationAdapter = {
		available: () => true,
		openPrefilled: overrides.openPrefilled ?? vi.fn().mockResolvedValue(undefined),
	};
	return { helper: new SelectionHelper({ settings: () => settings, dictionary, translation }) };
}

function candidate(
	text: string,
	overrides: Partial<Parameters<SelectionHelper["handleSelection"]>[0]> = {},
) {
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
