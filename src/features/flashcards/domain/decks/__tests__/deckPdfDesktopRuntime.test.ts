import { describe, expect, it } from "vite-plus/test";
import { getDesktopPdfRuntime, isDesktopPdfExportSupported } from "../deckPdfDesktopRuntime";

describe("deckPdfDesktopRuntime", () => {
	it("returns false for isDesktopPdfExportSupported when electron or require is missing (mobile mode)", () => {
		const fakeDoc = {
			defaultView: {},
		} as unknown as Document;

		expect(isDesktopPdfExportSupported(fakeDoc)).toBe(false);
	});

	it("returns true for isDesktopPdfExportSupported when electron remote and require exist", () => {
		const fakeDoc = {
			defaultView: {
				electron: {
					remote: {
						BrowserWindow: class FakeBrowserWindow {},
						dialog: { showSaveDialog: async () => ({ canceled: true }) },
						getCurrentWindow: () => ({}),
					},
				},
				require: () => ({}),
			},
		} as unknown as Document;

		expect(isDesktopPdfExportSupported(fakeDoc)).toBe(true);
	});

	it("throws an error in getDesktopPdfRuntime when desktop electron runtime is missing", () => {
		const fakeDoc = {
			defaultView: {},
		} as unknown as Document;

		expect(() => getDesktopPdfRuntime(fakeDoc)).toThrowError(
			"The Obsidian desktop PDF runtime is unavailable",
		);
	});
});
