import { describe, expect, it, vi } from "vite-plus/test";
import { DictionaryFavoriteSession } from "../../domain/favoriteSession";
import { FavoriteCategoryManager } from "../../domain/favorite-categories";
import { normalizeDictionarySettings } from "../../domain/configuration";
import type { FavoriteGeneratedDraft } from "../../domain/favorite-ai";
import type { StoredDictionaryFavorite } from "../../domain/favorite-file";
import type { DictionaryFavoriteOpenMode, DictionarySettingsStore } from "../../domain/types";
import { DictionaryFavoritePresentation } from "../favoritePresentation";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

const generated: FavoriteGeneratedDraft = { meaning: "生成释义", note: "生成笔记" };

function setup() {
	const settings = normalizeDictionarySettings({
		favoritePath: "words.md",
		favoriteAiConfigId: "favorite",
	});
	const file = {
		pathSuggestions: vi.fn(() => [] as string[]),
		ensureFile: vi.fn(async () => async () => undefined),
		moveFile: vi.fn(async () => async () => undefined),
		find: vi.fn(async (): Promise<StoredDictionaryFavorite | null> => null),
		save: vi.fn(async () => "words.md"),
		open: vi.fn(async () => true),
	};
	const store = {
		getDictionarySettings: () => settings,
		updateDictionarySettings: vi.fn(async (mutate: (draft: typeof settings) => void) => {
			mutate(settings);
			return true;
		}),
	} as unknown as DictionarySettingsStore;
	const generate = vi.fn(
		async (_word: string, _config: string, _signal: AbortSignal) => generated,
	);
	const categories = new FavoriteCategoryManager(store, file);
	const controller = new DictionaryFavoriteSession(categories, file, {
		generator: { generate },
		engineKey: () => "connection",
		language: () => "zh",
	});
	const unsubscribe = vi.fn();
	const subscribe = controller.subscribe.bind(controller);
	vi.spyOn(controller, "subscribe").mockImplementation((listener) => {
		const release = subscribe(listener);
		return () => {
			unsubscribe();
			release();
		};
	});
	let mode: DictionaryFavoriteOpenMode = "modal";
	const sidebarLeases = new Set<() => void>();
	let hostLeafPresent = false;
	function attachSidebar() {
		hostLeafPresent = true;
		const release = presentation.attachSidebar();
		const detach = () => {
			sidebarLeases.delete(detach);
			release();
		};
		sidebarLeases.add(detach);
		return detach;
	}
	const sidebar = {
		open: vi.fn(async () => {
			if (sidebarLeases.size === 0) attachSidebar();
		}),
	};
	const modals: Array<{
		visible: boolean;
		mounted: boolean;
		finishClose: () => void;
		open: ReturnType<typeof vi.fn<() => void>>;
		close: ReturnType<typeof vi.fn<() => void>>;
		updateSettings: ReturnType<typeof vi.fn<() => void>>;
		read: typeof controller.getSnapshot;
	}> = [];
	const reportOpenFailure = vi.fn();
	const presentation = new DictionaryFavoritePresentation({
		controller,
		mode: () => mode,
		sidebar,
		createModal(onClosing) {
			const modal = {
				visible: false,
				mounted: false,
				finishClose: () => {
					modal.mounted = false;
				},
				open: vi.fn(() => {
					modal.visible = true;
					modal.mounted = true;
				}),
				close: vi.fn(() => {
					modal.visible = false;
					onClosing();
				}),
				updateSettings: vi.fn(),
				read: () => controller.getSnapshot(),
			};
			modals.push(modal);
			return modal;
		},
		reportOpenFailure,
	});
	return {
		controller,
		file,
		generate,
		settings,
		sidebar,
		modals,
		presentation,
		reportOpenFailure,
		unsubscribe,
		setMode(value: DictionaryFavoriteOpenMode) {
			mode = value;
		},
		setSidebarVisible(value: boolean) {
			if (value && sidebarLeases.size === 0) attachSidebar();
			if (!value) for (const release of sidebarLeases) release();
		},
		attachSidebar,
		isSidebarOpen: () => sidebarLeases.size > 0,
		hasHostLeaf: () => hostLeafPresent,
		readSidebar: () => controller.getSnapshot(),
		closeSidebar() {
			const release = [...sidebarLeases][0];
			release?.();
			return release;
		},
	};
}

describe("favorite presentation collaboration", () => {
	it("shares edits between both surfaces, preserves a same-word draft and loads a new word", async () => {
		const h = setup();
		h.setMode("sidebar");
		await h.presentation.open("apple");
		h.setMode("modal");
		await h.presentation.open("apple");
		h.controller.setMeaning("手动释义");
		h.controller.setNote("手动笔记");
		await h.presentation.open("apple");
		expect(h.modals[0]!.read()).toMatchObject({
			word: "apple",
			meaning: "手动释义",
			note: "手动笔记",
		});
		expect(h.readSidebar()).toBe(h.modals[0]!.read());
		h.file.find.mockResolvedValueOnce({
			word: "pear",
			meaning: "梨",
			note: "已有笔记",
			path: "words.md",
		});
		await h.presentation.open("pear");
		expect(h.readSidebar()).toMatchObject({ word: "pear", meaning: "梨", note: "已有笔记" });
		expect(h.modals).toHaveLength(1);
		expect(h.modals[0]!.visible).toBe(true);
	});

	it("keeps the shared draft when one surface closes and clears it after the last closes", async () => {
		const h = setup();
		h.setSidebarVisible(true);
		await h.presentation.open("apple");
		h.controller.setMeaning("保留");
		h.modals[0]!.close();
		expect(h.readSidebar()).toMatchObject({ word: "apple", meaning: "保留" });
		h.closeSidebar();
		await Promise.resolve();
		expect(h.controller.getSnapshot()).toMatchObject({
			word: "",
			meaning: "",
			note: "",
			status: "idle",
		});
	});

	it("aborts AI on the last modal close and ignores its late completion", async () => {
		const h = setup();
		await h.presentation.open("apple");
		const pending = deferred<FavoriteGeneratedDraft>();
		h.generate.mockReturnValueOnce(pending.promise);
		const request = h.controller.generateAi();
		const signal = h.generate.mock.calls[0]![2];
		h.modals[0]!.close();
		expect(signal.aborted).toBe(true);
		pending.resolve(generated);
		await request;
		expect(h.controller.getSnapshot()).toMatchObject({ word: "", meaning: "", status: "idle" });
		expect(h.file.save).not.toHaveBeenCalled();
	});

	it("keeps generation alive when a sidebar closes but a modal still presents the draft", async () => {
		const h = setup();
		h.setSidebarVisible(true);
		await h.presentation.open("apple");
		const pending = deferred<FavoriteGeneratedDraft>();
		h.generate.mockReturnValueOnce(pending.promise);
		const request = h.controller.generateAi();
		h.closeSidebar();
		await Promise.resolve();
		expect(h.generate.mock.calls[0]![2].aborted).toBe(false);
		pending.resolve(generated);
		await request;
		expect(h.modals[0]!.read()).toMatchObject({ word: "apple", ...generated });
		expect(h.modals[0]!.visible).toBe(true);
	});

	it("keeps the draft while another sidebar remains after a leaf closes", async () => {
		const h = setup();
		h.setMode("sidebar");
		await h.presentation.open("apple");
		h.controller.setMeaning("仍有另一个侧栏");
		h.attachSidebar();
		h.closeSidebar();
		await Promise.resolve();
		expect(h.readSidebar()).toMatchObject({ word: "apple", meaning: "仍有另一个侧栏" });
	});

	it("closes only the modal after a real save and leaves the sidebar showing the result", async () => {
		const h = setup();
		h.setSidebarVisible(true);
		await h.presentation.open("apple");
		h.controller.setMeaning("苹果");
		h.controller.setNote("笔记");
		await h.controller.save();
		expect(h.file.save).toHaveBeenCalledExactlyOnceWith({
			word: "apple",
			meaning: "苹果",
			note: "笔记",
			path: "words.md",
		});
		expect(h.modals[0]!.visible).toBe(false);
		expect(h.modals[0]!.close).toHaveBeenCalledOnce();
		expect(h.isSidebarOpen()).toBe(true);
		expect(h.readSidebar()).toMatchObject({
			word: "apple",
			meaning: "苹果",
			status: "success",
		});
	});

	it("retains a failed save draft for retry, then closes the modal on successful retry", async () => {
		const h = setup();
		await h.presentation.open("apple");
		h.controller.setMeaning("苹果");
		h.file.save.mockRejectedValueOnce(new Error("disk full"));
		await h.controller.save();
		expect(h.modals[0]!.visible).toBe(true);
		expect(h.controller.getSnapshot()).toMatchObject({
			word: "apple",
			meaning: "苹果",
			status: "error",
		});
		expect(h.controller.getSnapshot().message).not.toBe("");
		await h.controller.save();
		expect(h.file.save).toHaveBeenCalledTimes(2);
		expect(h.modals[0]!.visible).toBe(false);
	});

	it("does not close the modal for existing-entry or AI success", async () => {
		const h = setup();
		h.file.find.mockResolvedValueOnce({
			word: "apple",
			meaning: "苹果",
			note: "",
			path: "words.md",
		});
		await h.presentation.open("apple");
		expect(h.controller.getSnapshot().status).toBe("success");
		expect(h.modals[0]!.visible).toBe(true);
		await h.controller.generateAi();
		expect(h.controller.getSnapshot()).toMatchObject({ ...generated, status: "success" });
		expect(h.modals[0]!.close).not.toHaveBeenCalled();
		expect(h.file.save).not.toHaveBeenCalled();
	});

	it.each(["success", "failure"])(
		"ignores an old save's late %s after close and reopen",
		async (outcome) => {
			const h = setup();
			await h.presentation.open("apple");
			h.controller.setMeaning("苹果");
			const pending = deferred<string>();
			h.file.save.mockReturnValueOnce(pending.promise);
			const save = h.controller.save();
			h.modals[0]!.close();
			await h.presentation.open("pear");
			h.controller.setMeaning("新草稿");
			if (outcome === "success") pending.resolve("words.md");
			else pending.reject(new Error("old failure"));
			await save;
			expect(h.file.save).toHaveBeenCalledWith(
				expect.objectContaining({ word: "apple", meaning: "苹果" }),
			);
			expect(h.controller.getSnapshot()).toMatchObject({
				word: "pear",
				meaning: "新草稿",
				status: "idle",
				message: "",
			});
			expect(h.modals[1]!.visible).toBe(true);
			expect(h.modals[1]!.close).not.toHaveBeenCalled();
		},
	);

	it("lets only the newest sidebar open prefill when requests resolve out of order", async () => {
		const h = setup();
		h.setMode("sidebar");
		const first = deferred<void>();
		const second = deferred<void>();
		h.sidebar.open.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		const oldOpen = h.presentation.open("apple");
		const newOpen = h.presentation.open("pear");
		h.setSidebarVisible(true);
		second.resolve();
		await newOpen;
		h.controller.setMeaning("新草稿");
		first.resolve();
		await oldOpen;
		expect(h.readSidebar()).toMatchObject({ word: "pear", meaning: "新草稿" });
		expect(h.file.find).toHaveBeenCalledExactlyOnceWith("words.md", "pear");
	});

	it("does not let a pending sidebar request replace or close a newer modal", async () => {
		const h = setup();
		h.setMode("sidebar");
		const pending = deferred<void>();
		h.sidebar.open.mockReturnValueOnce(pending.promise);
		const oldOpen = h.presentation.open("apple");
		h.setMode("modal");
		await h.presentation.open("pear");
		h.controller.setMeaning("新草稿");
		h.setSidebarVisible(true);
		pending.resolve();
		await oldOpen;
		expect(h.modals[0]!.visible).toBe(true);
		expect(h.modals[0]!.close).not.toHaveBeenCalled();
		expect(h.controller.getSnapshot()).toMatchObject({ word: "pear", meaning: "新草稿" });
	});

	it("does not report a stale sidebar failure over a newer modal request", async () => {
		const h = setup();
		h.setMode("sidebar");
		const pending = deferred<void>();
		h.sidebar.open.mockReturnValueOnce(pending.promise);
		const oldOpen = h.presentation.open("apple");
		h.setMode("modal");
		await h.presentation.open("pear");
		pending.reject(new Error("stale failure"));
		await oldOpen;
		expect(h.reportOpenFailure).not.toHaveBeenCalled();
		expect(h.modals[0]!.visible).toBe(true);
		expect(h.controller.getSnapshot().word).toBe("pear");
	});

	it("keeps the original modal and draft until a sidebar switch succeeds", async () => {
		const h = setup();
		await h.presentation.open("apple");
		h.controller.setMeaning("原草稿");
		h.setMode("sidebar");
		const pending = deferred<void>();
		h.sidebar.open.mockReturnValueOnce(pending.promise);
		const switchOpen = h.presentation.open("pear");
		expect(h.modals[0]!.visible).toBe(true);
		pending.reject(new Error("sidebar unavailable"));
		await switchOpen;
		expect(h.modals[0]!.visible).toBe(true);
		expect(h.controller.getSnapshot()).toMatchObject({ word: "apple", meaning: "原草稿" });
		expect(h.reportOpenFailure).toHaveBeenCalledOnce();
		await h.presentation.open("apple");
		expect(h.modals[0]!.visible).toBe(false);
		expect(h.readSidebar()).toMatchObject({ word: "apple", meaning: "原草稿" });
	});

	it("applies a mode preference on the next open rather than settings refresh", async () => {
		const h = setup();
		await h.presentation.open("apple");
		h.controller.setMeaning("原草稿");
		h.setMode("sidebar");
		h.presentation.refresh();
		expect(h.modals[0]!.updateSettings).toHaveBeenCalledOnce();
		expect(h.modals[0]!.visible).toBe(true);
		expect(h.sidebar.open).not.toHaveBeenCalled();
		await h.presentation.open("apple");
		expect(h.isSidebarOpen()).toBe(true);
		expect(h.modals[0]!.visible).toBe(false);
		expect(h.readSidebar().meaning).toBe("原草稿");
	});

	it("ignores duplicate sidebar lease release after a new modal opens", async () => {
		const h = setup();
		h.setMode("sidebar");
		await h.presentation.open("apple");
		const release = h.closeSidebar();
		h.setMode("modal");
		const newOpen = h.presentation.open("pear");
		h.controller.setMeaning("新草稿");
		release?.();
		await newOpen;
		expect(h.modals[0]!.visible).toBe(true);
		expect(h.controller.getSnapshot()).toMatchObject({ word: "pear", meaning: "新草稿" });
	});

	it("releases the last sidebar immediately while the host still retains its closing leaf", async () => {
		const h = setup();
		h.setMode("sidebar");
		await h.presentation.open("apple");
		const pending = deferred<FavoriteGeneratedDraft>();
		h.generate.mockReturnValueOnce(pending.promise);
		const request = h.controller.generateAi();
		h.closeSidebar();
		expect(h.hasHostLeaf()).toBe(true);
		expect(h.generate.mock.calls[0]![2].aborted).toBe(true);
		expect(h.controller.getSnapshot()).toMatchObject({ word: "", meaning: "", status: "idle" });
		pending.resolve(generated);
		await request;
		expect(h.controller.getSnapshot().meaning).toBe("");
	});

	it("opens a new modal while the old close animation finishes without clearing its draft", async () => {
		const h = setup();
		await h.presentation.open("apple");
		h.modals[0]!.close();
		expect(h.modals[0]!.mounted).toBe(true);
		expect(h.controller.getSnapshot().word).toBe("");
		await h.presentation.open("pear");
		h.controller.setMeaning("新草稿");
		expect(h.modals).toHaveLength(2);
		h.modals[0]!.finishClose();
		expect(h.modals[0]!.mounted).toBe(false);
		expect(h.modals[1]!.visible).toBe(true);
		expect(h.controller.getSnapshot()).toMatchObject({ word: "pear", meaning: "新草稿" });
	});

	it("disposes idempotently, releases its subscription and ignores pending opens", async () => {
		const h = setup();
		await h.presentation.open("apple");
		h.setMode("sidebar");
		const pending = deferred<void>();
		h.sidebar.open.mockReturnValueOnce(pending.promise);
		const request = h.presentation.open("pear");
		h.presentation.dispose();
		h.presentation.dispose();
		h.presentation.refresh();
		pending.resolve();
		await request;
		await h.presentation.open("banana");
		expect(h.unsubscribe).toHaveBeenCalledOnce();
		expect(h.modals[0]!.close).toHaveBeenCalledOnce();
		expect(h.modals[0]!.updateSettings).not.toHaveBeenCalled();
		expect(h.controller.getSnapshot()).toMatchObject({ word: "", meaning: "", status: "idle" });
		expect(h.file.find).toHaveBeenCalledExactlyOnceWith("words.md", "apple");
		// The controller remains independently usable after its presentation is released.
		await h.controller.prefill("banana");
		h.controller.setMeaning("香蕉");
		await h.controller.save();
		expect(h.controller.getSnapshot()).toMatchObject({ word: "banana", status: "success" });
		expect(h.modals[0]!.close).toHaveBeenCalledOnce();
	});
});
