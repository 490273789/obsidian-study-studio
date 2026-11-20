import { describe, expect, it, vi } from "vite-plus/test";
import { createFakeWorkbenchHost } from "../../../../core/host/__tests__/fakeWorkbenchHost";
import { DEFAULT_DICTIONARY_SETTINGS } from "../../domain/configuration";
import { createDictionarySettingsStore } from "../settingsStore";

describe("dictionary settings writes", () => {
	it("normalizes the updated slice before passing it back to the host", async () => {
		const { host } = createFakeWorkbenchHost("dictionary");
		const settings = createDictionarySettingsStore(host.settings);

		await expect(
			settings.updateDictionarySettings((draft) => {
				draft.history = [" pear ", "pear"];
			}),
		).resolves.toBe(true);

		expect(host.settings.read().dictionary.history).toEqual(["pear"]);
	});

	it("discards a failed mutation and allows a subsequent write", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		try {
			const { host } = createFakeWorkbenchHost("dictionary");
			const settings = createDictionarySettingsStore(host.settings);

			await expect(
				settings.updateDictionarySettings((draft) => {
					draft.sources = [];
					throw new Error("Invalid catalog change");
				}),
			).resolves.toBe(false);
			await expect(
				settings.updateDictionarySettings((draft) => {
					draft.history.push("pear");
				}),
			).resolves.toBe(true);

			expect(settings.getDictionarySettings()).toMatchObject({
				history: ["pear"],
				sources: DEFAULT_DICTIONARY_SETTINGS.sources,
			});
		} finally {
			consoleError.mockRestore();
		}
	});
});
