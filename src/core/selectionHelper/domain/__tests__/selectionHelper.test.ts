import { describe, expect, it, vi } from "vite-plus/test";
import { SelectionHelper } from "../selectionHelper";
import type {
	SelectionAction,
	SelectionCandidate,
	SelectionDictionarySourceProvider,
	SelectionHelperSettings,
	SelectionTranslationAdapter,
} from "../types";

describe("SelectionHelper", () => {
	it("explicitly opens dictionary mode despite disabled automatic capture", () => {
		const settings: SelectionHelperSettings = {
			enabled: false,
			modifier: "alt",
			openMainShortcut: "Ctrl+Enter",
			dictionaryOrder: [],
			selectedDictionaries: [],
		};
		const { helper } = setup({ settings });
		const source = helper.openSource({});
		const pending = source.capture();
		helper.openDictionary(source.reference);
		expect(helper.getSnapshot()).toMatchObject({
			visible: true,
			mode: "slot",
			activeSlotId: "dictionary",
			target: { text: "", trigger: "manual" },
		});
		expect(pending.submit(candidate("late"))).toBe(false);
		helper.refresh();
		expect(helper.getSnapshot().visible).toBe(true);
		source.dispose();
		expect(helper.getSnapshot().visible).toBe(false);
	});

	it("preserves the open card without a new valid selection and updates target for new words", () => {
		const { helper } = setup();
		const source = helper.openSource({});
		helper.openDictionary(source.reference, { text: "first", x: 4, y: 8 });
		const snapshot = helper.getSnapshot();
		helper.openDictionary(source.reference, { text: "不是英文", x: 0, y: 0 });
		expect(helper.getSnapshot()).toBe(snapshot);
		helper.openDictionary(source.reference);
		expect(helper.getSnapshot()).toBe(snapshot);
		helper.openDictionary(source.reference, { text: "second", x: 9, y: 8 });
		expect(helper.getSnapshot().target?.text).toBe("second");
	});

	it("keeps manual lookup visible when no dictionary source is available", () => {
		const { helper, dictionary } = setup();
		dictionary.sources = () => [];
		const source = helper.openSource({});
		helper.openDictionary(source.reference, { text: "hello", x: 1, y: 2 });
		expect(helper.getSnapshot()).toMatchObject({
			visible: true,
			mode: "slot",
			activeSlotId: "dictionary",
			target: { text: "hello" },
		});
		helper.dismiss();
		helper.openDictionary(source.reference);
		expect(helper.getSnapshot().target?.text).toBe("");
		source.dispose();
		helper.openDictionary(source.reference);
		expect(helper.getSnapshot().visible).toBe(false);
	});

	it("switches to dictionary mode on beginLookup", () => {
		const { helper } = setup();
		select(helper, candidate("hello"));
		expect(helper.getSnapshot()).toMatchObject({
			visible: true,
			mode: "actions",
			canLookup: true,
		});
		helper.beginLookup();
		expect(helper.getSnapshot()).toMatchObject({
			visible: true,
			mode: "slot",
			activeSlotId: "dictionary",
			target: { text: "hello" },
		});
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

	it("reflects canLookup based on active sources configuration", () => {
		const { helper } = setup({
			settings: {
				enabled: true,
				modifier: "none",
				openMainShortcut: "Ctrl+Enter",
				dictionaryOrder: [],
				selectedDictionaries: ["missing"],
			},
		});
		select(helper, candidate("hello"));
		expect(helper.getSnapshot().canLookup).toBe(false);
	});

	it("replaces the previous selection and discards earlier updates", () => {
		const { helper } = setup();
		select(helper, candidate("first"));
		helper.beginLookup();
		select(helper, candidate("second"));
		expect(helper.getSnapshot().target?.text).toBe("second");
		expect(helper.getSnapshot().mode).toBe("actions");
	});

	it("preserves an open lookup when its source reports the same selection again", () => {
		const { helper } = setup();
		const source = helper.openSource({});
		source.capture().submit(candidate("hello"));
		helper.beginLookup();
		expect(source.capture().submit(candidate(""))).toBe(false);
		expect(source.capture().submit(candidate("hello"))).toBe(false);
		expect(helper.getSnapshot()).toMatchObject({
			visible: true,
			mode: "slot",
			activeSlotId: "dictionary",
		});

		expect(source.capture().submit(candidate("hello", { x: 30 }))).toBe(true);
		expect(helper.getSnapshot()).toMatchObject({
			visible: true,
			mode: "actions",
			target: { x: 30 },
		});
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
		const { helper } = setup();
		const source = helper.openSource({});
		source.capture().submit(candidate("hello"));
		helper.beginLookup();
		const pending = source.capture();
		helper.interrupt();
		pending.dismiss();
		expect(pending.submit(candidate("old"))).toBe(false);
		expect(helper.getSnapshot().mode).toBe("slot");
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

	it("releases a disappearing selection but accepts a fresh selection from the same source", () => {
		const { helper } = setup();
		const source = helper.openSource({});
		source.capture().submit(candidate("hello"));
		helper.beginLookup();
		const pending = source.capture();
		source.dismiss();
		expect(pending.isCurrent()).toBe(false);
		expect(source.active).toBe(true);
		expect(helper.getSnapshot().visible).toBe(false);

		source.capture().submit(candidate("next"));
		expect(helper.getSnapshot()).toMatchObject({
			visible: true,
			mode: "actions",
			target: { text: "next" },
		});
	});

	it.each([
		{ modifier: "shift" as const, key: "shiftKey" as const },
		{ modifier: "ctrl" as const, key: "ctrlOrMetaKey" as const },
	])("honors the $modifier modifier setting", ({ modifier, key }) => {
		const { helper } = setup({
			settings: {
				enabled: true,
				modifier,
				openMainShortcut: "Ctrl+Enter",
				dictionaryOrder: [],
				selectedDictionaries: [],
			},
		});
		select(helper, candidate("hello", { [key]: false }));
		expect(helper.getSnapshot().visible).toBe(false);
		select(helper, candidate("hello", { [key]: true }));
		expect(helper.getSnapshot().visible).toBe(true);
	});

	it("filters candidates against generic selection action eligibility and triggers execution", async () => {
		const executeMock = vi.fn();
		const customAction: SelectionAction = {
			id: "custom",
			label: () => "Custom Action",
			isEligible: (ctx) => ctx.text.startsWith("custom:"),
			execute: executeMock,
		};
		const helper = new SelectionHelper({
			settings: () => ({ enabled: true, modifier: "none", openMainShortcut: "Ctrl+Enter" }),
			actions: [customAction],
		});

		// Ineligible text should not show popup
		select(helper, candidate("regular text"));
		expect(helper.getSnapshot().visible).toBe(false);

		// Eligible text should show actions popup
		select(helper, candidate("custom:hello"));
		expect(helper.getSnapshot()).toMatchObject({
			visible: true,
			mode: "actions",
			eligibleActionIds: ["custom"],
			target: { text: "custom:hello" },
		});
		expect(helper.eligibleActions).toEqual([customAction]);

		// Triggering action executes callback and dismisses popup
		await helper.triggerAction("custom");
		expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({ text: "custom:hello" }));
		expect(helper.getSnapshot().visible).toBe(false);
	});

	it("transitions to slot mode for slot-based action and opens arbitrary slots", async () => {
		const slotAction: SelectionAction = {
			id: "ai-card",
			label: () => "AI Card",
			slotId: "ai-slot",
			isEligible: () => true,
			execute: vi.fn(),
		};
		const helper = new SelectionHelper({
			settings: () => ({ enabled: true, modifier: "none", openMainShortcut: "Ctrl+Enter" }),
			actions: [slotAction],
		});

		select(helper, candidate("test"));
		expect(helper.getSnapshot().mode).toBe("actions");

		// Triggering slot action switches mode to slot
		await helper.triggerAction("ai-card");
		expect(helper.getSnapshot()).toMatchObject({
			visible: true,
			mode: "slot",
			activeSlotId: "ai-slot",
		});

		// Can open arbitrary slot explicitly
		const source = helper.openSource({});
		helper.openSlot("custom-slot", source.reference, { text: "manual", x: 10, y: 20 });
		expect(helper.getSnapshot()).toMatchObject({
			visible: true,
			mode: "slot",
			activeSlotId: "custom-slot",
			target: { text: "manual" },
		});
	});
});

function setup(
	overrides: {
		settings?: SelectionHelperSettings;
		openPrefilled?: SelectionTranslationAdapter["openPrefilled"];
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
	const dictionary: SelectionDictionarySourceProvider = {
		sources: () => [
			{ id: "a", label: "A", kind: "dictionary" },
			{ id: "b", label: "B", kind: "ai" },
		],
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

function select(helper: SelectionHelper, value: SelectionCandidate): boolean {
	return helper.openSource({}).capture().submit(value);
}
