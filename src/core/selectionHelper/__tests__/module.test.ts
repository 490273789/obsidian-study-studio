import { describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_SETTINGS } from "../../host/settingsSlices";
import { createFakeWorkbenchHost } from "../../host/__tests__/fakeWorkbenchHost";
import type { SelectionDictionaryAdapter, SelectionTranslationAdapter } from "../domain/types";
import { createSelectionHelperModule } from "../module";

vi.mock("obsidian", () => ({ Platform: { isDesktopApp: true } }));

describe("selection helper workbench module", () => {
	it.each([false, true])(
		"locks dictionary edits while sorting persists and unlocks after settlement (failure: %s)",
		async (failure) => {
			const dictionary = dictionaryAdapter();
			dictionary.sources = () =>
				["a", "b"].map((id) => ({ id, label: id, kind: "dictionary" }));
			const module = createSelectionHelperModule({
				dictionary,
				translation: translationAdapter(),
			});
			const fake = createFakeWorkbenchHost("selectionHelper");
			const update = fake.updateSettings.getMockImplementation()! as (
				patch: Parameters<typeof fake.host.settings.update>[0],
			) => Promise<void>;
			let settle!: () => void;
			fake.updateSettings.mockImplementationOnce(async (patch) => {
				await new Promise<void>((resolve, reject) => {
					settle = () => (failure ? reject(new Error("save failed")) : resolve());
				});
				await update(patch);
			});
			module.render(fake.host);
			const section = fake.sections.get("selectionPopup")!;
			const presentation = section.presentation("zh");
			const list = presentation.snapshot.groups[0]!.rows[4]!.controls[0];
			if (list?.kind !== "reorderable") throw new Error("Expected reorderable list");
			const pending = presentation.invoke({
				action: list.moveAction,
				value: { fromIndex: 0, toIndex: 1 },
			});
			await Promise.resolve();
			const busy = section.presentation("zh").snapshot.groups[0]!.rows[4]!.controls[0];
			expect(busy?.disabled).toBe(true);
			await presentation.invoke({ action: list.items[0]!.toggleAction, value: false });
			expect(fake.updateSettings).toHaveBeenCalledOnce();
			settle();
			expect((await pending).status).toBe(failure ? "failed" : "applied");
			expect(
				section.presentation("zh").snapshot.groups[0]!.rows[4]!.controls[0]?.disabled,
			).toBe(false);
			expect(fake.host.settings.read().selectionPopup.selectedDictionaries).toEqual([]);
			expect(fake.host.settings.read().selectionPopup.dictionaryOrder).toEqual(
				failure ? [] : ["b", "a"],
			);
			module.stop();
		},
	);

	it("persists popup sorting independently of dictionary selection and catalog order", async () => {
		const dictionary = dictionaryAdapter();
		const sources = ["a", "b", "c"].map((id) => ({
			id,
			label: id,
			kind: "dictionary" as const,
		}));
		dictionary.sources = () => sources;
		const module = createSelectionHelperModule({
			dictionary,
			translation: translationAdapter(),
		});
		const fake = createFakeWorkbenchHost("selectionHelper");
		module.render(fake.host);
		const section = fake.sections.get("selectionPopup")!;
		const presentation = section.presentation("zh");
		const list = presentation.snapshot.groups[0]!.rows[4]!.controls[0];
		if (list?.kind !== "reorderable") throw new Error("Expected reorderable list");
		await presentation.invoke({ action: list.moveAction, value: { fromIndex: 2, toIndex: 0 } });
		expect(fake.host.settings.read().selectionPopup).toMatchObject({
			dictionaryOrder: ["c", "a", "b"],
			selectedDictionaries: [],
		});
		expect(sources.map((source) => source.id)).toEqual(["a", "b", "c"]);
		const refreshed = section.presentation("zh");
		const next = refreshed.snapshot.groups[0]!.rows[4]!.controls[0];
		if (next?.kind !== "reorderable") throw new Error("Expected reorderable list");
		expect(next.items.map((item) => item.id)).toEqual(["c", "a", "b"]);
		await refreshed.invoke({ action: next.items[0]!.toggleAction, value: false });
		expect(fake.host.settings.read().selectionPopup).toMatchObject({
			dictionaryOrder: ["c", "a", "b"],
			selectedDictionaries: ["a", "b"],
		});
		expect(fake.settingsTab.refresh).toHaveBeenCalledWith("selectionPopup");
		module.stop();
	});

	it("registers settings without contributing a feature catalog entry", () => {
		const module = createSelectionHelperModule({
			dictionary: dictionaryAdapter(),
			translation: translationAdapter(),
		});
		const fakeHost = createFakeWorkbenchHost("selectionHelper", DEFAULT_SETTINGS);

		module.render(fakeHost.host);

		const section = fakeHost.sections.get("selectionPopup");
		expect(section?.order).toBe(4);
		expect(section?.presentation("zh").snapshot.groups[0]?.heading).toBe("划词助手");
		expect(fakeHost.catalog.size).toBe(0);
		expect(() => module.stop()).not.toThrow();
	});

	it("saves and resets the main-tab shortcut from the selection helper settings", async () => {
		const module = createSelectionHelperModule({
			dictionary: dictionaryAdapter(),
			translation: translationAdapter(),
		});
		const fake = createFakeWorkbenchHost("selectionHelper");
		module.render(fake.host);
		const section = fake.sections.get("selectionPopup")!;
		const presentation = section.presentation("zh");
		const changed = presentation.snapshot.groups[0]!.rows[2]!.controls[0];
		if (changed?.kind !== "keybinding") throw new Error("Expected keybinding");
		await presentation.invoke({ action: changed.action, value: "Alt+K" });
		expect(fake.host.settings.read().selectionPopup.openMainShortcut).toBe("Alt+K");
		const refreshed = section.presentation("zh");
		const reset = refreshed.snapshot.groups[0]!.rows[2]!.controls[1];
		if (reset?.kind !== "button") throw new Error("Expected reset button");
		await refreshed.invoke({ action: reset.action, value: undefined });
		expect(fake.host.settings.read().selectionPopup.openMainShortcut).toBe("Ctrl+Enter");
		module.stop();
	});
});

function dictionaryAdapter(): SelectionDictionaryAdapter {
	return {
		sources: () => [],
		startLookup: () => null,
		openInMainTab: vi.fn().mockResolvedValue(undefined),
	};
}

function translationAdapter(): SelectionTranslationAdapter {
	return {
		available: () => false,
		openPrefilled: vi.fn().mockResolvedValue(undefined),
	};
}
