import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../host/settingsSlices";
import { createFakeWorkbenchHost } from "../../host/__tests__/fakeWorkbenchHost";
import type { SelectionDictionaryAdapter, SelectionTranslationAdapter } from "../domain/types";
import { createSelectionHelperModule } from "../module";

describe("selection helper workbench module", () => {
	it("registers settings without contributing a feature catalog entry", () => {
		const module = createSelectionHelperModule({
			dictionary: dictionaryAdapter(),
			translation: translationAdapter(),
		});
		const fakeHost = createFakeWorkbenchHost("selectionHelper", DEFAULT_SETTINGS);

		module.render(fakeHost.host);

		const section = fakeHost.sections.get("selectionPopup");
		expect(section?.order).toBe(4);
		expect(section?.definitions("zh")[0]?.heading).toBe("划词助手");
		expect(fakeHost.catalog.size).toBe(0);
		expect(() => module.stop()).not.toThrow();
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
