import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { App } from "obsidian";
import type { DictionaryFavoriteController } from "../../domain/favorite-controller";
import { DictionaryFavoriteModal } from "../favoriteModal";

const root = vi.hoisted(() => ({ render: vi.fn(), unmount: vi.fn() }));
const nativeCloses = vi.hoisted(() => [] as (() => void)[]);
vi.mock("react-dom/client", () => ({ createRoot: () => root }));
vi.mock("../../../../core/host/reactItemView", () => ({ ReactViewErrorBoundary: () => null }));
vi.mock("obsidian", () => ({
	Modal: class {
		modalEl = { addClass: vi.fn(), setAttribute: vi.fn() };
		contentEl = { addClass: vi.fn(), createDiv: vi.fn(), empty: vi.fn() };
		close() {
			nativeCloses.push(() => this.onClose());
		}
		onClose() {}
	},
}));

describe("favorite modal adapter", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		nativeCloses.length = 0;
	});

	it("renders the current language and reports dismissal before native animation cleanup", () => {
		let language: "zh" | "en" = "zh";
		const closing = vi.fn();
		const modal = new DictionaryFavoriteModal(
			{} as App,
			{} as DictionaryFavoriteController,
			() => language,
			closing,
		);
		const empty = vi.spyOn(modal.contentEl, "empty");
		modal.onOpen();
		expect(root.render.mock.calls[0]![0].props.language).toBe("zh");
		language = "en";
		modal.updateSettings();
		expect(root.render.mock.calls[1]![0].props.language).toBe("en");
		modal.close();
		expect(closing).toHaveBeenCalledOnce();
		expect(root.unmount).not.toHaveBeenCalled();
		nativeCloses.shift()!();
		expect(root.unmount).toHaveBeenCalledOnce();
		expect(empty).toHaveBeenCalledOnce();
		expect(closing).toHaveBeenCalledOnce();
	});
});
