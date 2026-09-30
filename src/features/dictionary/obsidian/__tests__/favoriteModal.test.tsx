import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { DictionaryFavoriteController } from "../../domain/favorite-controller";
import type { DictionaryFavoriteViewState } from "../../domain/types";
import { DictionaryFavoriteModal } from "../favoriteModal";

const root = vi.hoisted(() => ({ render: vi.fn(), unmount: vi.fn() }));
vi.mock("react-dom/client", () => ({ createRoot: () => root }));
vi.mock("../../../../core/host/reactItemView", () => ({ ReactViewErrorBoundary: () => null }));
vi.mock("obsidian", () => ({
	Modal: class {
		modalEl = { addClass: vi.fn(), setAttribute: vi.fn() };
		contentEl = { addClass: vi.fn(), createDiv: vi.fn(), empty: vi.fn() };
		close() {
			this.onClose();
		}
		onClose() {}
	},
}));

function setup(initialStatus: DictionaryFavoriteViewState["status"] = "idle") {
	let status = initialStatus;
	const listeners = new Set<() => void>();
	const unsubscribe = vi.fn((listener: () => void) => listeners.delete(listener));
	const controller = {
		getSnapshot: () => ({ status }),
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => unsubscribe(listener);
		},
	};
	const closed = vi.fn();
	const modal = new DictionaryFavoriteModal(
		{} as App,
		controller as unknown as DictionaryFavoriteController,
		() => "zh",
		closed,
	);
	const close = vi.spyOn(modal, "close");
	modal.onOpen();
	return {
		modal,
		close,
		closed,
		unsubscribe,
		transition: (next: DictionaryFavoriteViewState["status"]) => {
			status = next;
			for (const listener of listeners) listener();
		},
	};
}

describe("favorite modal save completion", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});
	it("closes only after an active save succeeds and releases its subscription", () => {
		const { transition, close, closed, unsubscribe } = setup();
		transition("saving");
		expect(close).not.toHaveBeenCalled();
		transition("success");
		expect(close).toHaveBeenCalledOnce();
		expect(closed).toHaveBeenCalledOnce();
		expect(root.unmount).toHaveBeenCalledOnce();
		expect(unsubscribe).toHaveBeenCalledOnce();
		transition("saving");
		transition("success");
		expect(close).toHaveBeenCalledOnce();
	});
	it("keeps the modal open on a save failure and closes after a successful retry", () => {
		const { transition, close } = setup();
		transition("saving");
		transition("error");
		expect(close).not.toHaveBeenCalled();
		expect(root.unmount).not.toHaveBeenCalled();
		transition("saving");
		transition("success");
		expect(close).toHaveBeenCalledOnce();
	});
	it("stays open for existing-favorite prefill and AI generation success", () => {
		const { transition, close } = setup("success");
		expect(close).not.toHaveBeenCalled();
		transition("idle");
		transition("success");
		transition("generating");
		transition("success");
		expect(close).not.toHaveBeenCalled();
		expect(root.unmount).not.toHaveBeenCalled();
	});
	it("does not close a reopened modal when an old save is superseded by a new session", () => {
		const { modal, transition, close, closed } = setup();
		transition("saving");
		modal.onClose();
		transition("idle");
		modal.onOpen();
		transition("success");
		expect(close).not.toHaveBeenCalled();
		expect(closed).toHaveBeenCalledOnce();
	});
});
