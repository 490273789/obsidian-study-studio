import { describe, expect, it, vi } from "vitest";
import { DictionaryFavoriteController } from "../favorite-controller";
import { normalizeDictionarySettings } from "../configuration";
import type { DictionaryFavoriteFile, StoredDictionaryFavorite } from "../favorite-file";
import type { DictionarySettingsStore } from "../types";
import type { FavoriteGeneratedDraft } from "../favorite-ai";
import { TransportError } from "../../../../core/net/types";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
const draft: FavoriteGeneratedDraft = {
	meaning: "n. 交换",
	note: "/test/\n\nThis is a test.\n这是一个测试。",
};
function setup() {
	const settings = normalizeDictionarySettings({
		favoriteAiConfigId: "favorite",
		favoritePath: "word.md",
	});
	const file = {
		suggestions: vi.fn(() => ["word.md"]),
		find: vi.fn(async (): Promise<StoredDictionaryFavorite | null> => null),
		save: vi.fn(async () => "word.md"),
		open: vi.fn(async () => true),
	};
	const generate = vi.fn(async (_word: string, _config: string, _signal: AbortSignal) => draft);
	let engine: string | null = "favorite connection";
	const store = {
		getDictionarySettings: () => settings,
		updateDictionarySettings: vi.fn(async (mutate) => {
			mutate(settings);
			return true;
		}),
	} as unknown as DictionarySettingsStore;
	const controller = new DictionaryFavoriteController(
		store,
		file as unknown as DictionaryFavoriteFile,
		vi.fn(),
		{ generator: { generate }, language: () => "zh", engineKey: () => engine },
	);
	return {
		controller,
		file,
		generate,
		settings,
		setEngine: (key: string | null) => {
			engine = key;
		},
	};
}

describe("favorite generation interaction", () => {
	it("replaces both draft fields without saving and permits subsequent manual edits", async () => {
		const { controller, file } = setup();
		await controller.prefill("exchange");
		controller.setMeaning("old meaning");
		controller.setNote("old note");
		await controller.generateAi();
		expect(controller.getSnapshot()).toMatchObject({ ...draft, status: "success" });
		expect(file.save).not.toHaveBeenCalled();
		controller.setNote("edited");
		await controller.save();
		expect(file.save).toHaveBeenCalledWith({
			word: "exchange",
			meaning: draft.meaning,
			note: "edited",
			path: "word.md",
		});
	});
	it("keeps the complete old draft on failure and supports retry", async () => {
		const { controller, generate } = setup();
		await controller.prefill("exchange");
		controller.setMeaning("old");
		controller.setNote("note");
		generate.mockRejectedValueOnce(new TransportError("invalid-response"));
		await controller.generateAi();
		expect(controller.getSnapshot()).toMatchObject({
			meaning: "old",
			note: "note",
			status: "error",
		});
		await controller.generateAi();
		expect(controller.getSnapshot()).toMatchObject(draft);
	});
	it("locks semantic edits and save while generating and coalesces repeated clicks", async () => {
		const { controller, file, generate } = setup();
		const pending = deferred<FavoriteGeneratedDraft>();
		await controller.prefill("exchange");
		generate.mockReturnValueOnce(pending.promise);
		const request = controller.generateAi();
		await controller.generateAi();
		controller.setMeaning("ignored");
		controller.setNote("ignored");
		await controller.save();
		expect(controller.getSnapshot()).toMatchObject({
			status: "generating",
			meaning: "",
			note: "",
		});
		expect(generate).toHaveBeenCalledOnce();
		expect(file.save).not.toHaveBeenCalled();
		pending.resolve(draft);
		await request;
	});
	it.each(["reset", "clear", "word", "dispose", "config"])(
		"cancels on %s and ignores late replies",
		async (action) => {
			const { controller, generate, setEngine } = setup();
			const pending = deferred<FavoriteGeneratedDraft>();
			await controller.prefill("exchange");
			generate.mockReturnValueOnce(pending.promise);
			const request = controller.generateAi();
			const signal = generate.mock.calls[0]![2];
			if (action === "reset") controller.resetSession();
			if (action === "clear") controller.clear();
			if (action === "word") await controller.prefill("other");
			if (action === "dispose") controller.dispose();
			if (action === "config") {
				setEngine(null);
				controller.refreshSettings();
			}
			expect(signal.aborted).toBe(true);
			pending.resolve(draft);
			await request;
			expect(controller.getSnapshot().meaning).not.toBe(draft.meaning);
		},
	);
	it("discards late file prefill and preserves generated content through settings refresh", async () => {
		const { controller, file } = setup();
		const lookup = deferred<StoredDictionaryFavorite | null>();
		file.find.mockReturnValueOnce(lookup.promise);
		const prefill = controller.prefill("exchange");
		await controller.generateAi();
		lookup.resolve({ word: "exchange", meaning: "stale", note: "stale", path: "word.md" });
		await prefill;
		controller.refreshSettings();
		await Promise.resolve();
		expect(controller.getSnapshot()).toMatchObject(draft);
		expect(file.find).toHaveBeenCalledOnce();
	});
	it("does not let an earlier failed file-open unlock the generation", async () => {
		const { controller, file, generate } = setup();
		const opened = deferred<boolean>();
		const pending = deferred<FavoriteGeneratedDraft>();
		await controller.prefill("exchange");
		file.open.mockReturnValueOnce(opened.promise);
		const opening = controller.openSavedFile();
		generate.mockReturnValueOnce(pending.promise);
		const request = controller.generateAi();
		opened.resolve(false);
		await opening;
		await controller.openSavedFile();
		controller.setMeaning("ignored");
		await controller.save();
		expect(controller.getSnapshot()).toMatchObject({ status: "generating", meaning: "" });
		expect(file.open).toHaveBeenCalledOnce();
		expect(file.save).not.toHaveBeenCalled();
		pending.resolve(draft);
		await request;
	});

	it("cannot let an old generation overwrite a reopened session's request", async () => {
		const { controller, generate } = setup();
		const old = deferred<FavoriteGeneratedDraft>();
		const next = deferred<FavoriteGeneratedDraft>();
		await controller.prefill("exchange");
		generate.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
		const first = controller.generateAi();
		controller.resetSession();
		await controller.prefill("new");
		const second = controller.generateAi();
		old.resolve(draft);
		await first;
		expect(controller.getSnapshot()).toMatchObject({
			word: "new",
			status: "generating",
			meaning: "",
		});
		next.resolve({ ...draft, meaning: "adj. 新的" });
		await second;
		expect(controller.getSnapshot().meaning).toBe("adj. 新的");
	});
	it.each(["success", "failure"])(
		"finishes a %s save when external settings change the path",
		async (outcome) => {
			const { controller, file, settings } = setup();
			const saved = deferred<string>();
			await controller.prefill("exchange");
			file.save.mockReturnValueOnce(saved.promise);
			const request = controller.save();
			settings.favoritePath = "new.md";
			controller.refreshSettings();
			expect(controller.getSnapshot().status).toBe("saving");
			if (outcome === "success") saved.resolve("word.md");
			else saved.reject(new Error("write failed"));
			await request;
			expect(controller.getSnapshot()).toMatchObject({
				status: outcome === "success" ? "success" : "error",
				path: "new.md",
				savedPath: "new.md",
			});
		},
	);
	it("lets an accepted save finish without altering a reopened session", async () => {
		const { controller, file } = setup();
		const saved = deferred<string>();
		await controller.prefill("exchange");
		file.save.mockReturnValueOnce(saved.promise);
		const request = controller.save();
		controller.resetSession();
		await controller.prefill("other");
		saved.resolve("word.md");
		await request;
		expect(controller.getSnapshot()).toMatchObject({
			word: "other",
			status: "idle",
			meaning: "",
		});
	});

	it("does not request missing engines, unsupported input, or during ordinary prefill", async () => {
		const { controller, generate, settings, setEngine } = setup();
		await controller.prefill("exchange");
		expect(generate).not.toHaveBeenCalled();
		settings.favoriteAiConfigId = null;
		await controller.generateAi();
		settings.favoriteAiConfigId = "deleted";
		setEngine(null);
		await controller.generateAi();
		await controller.prefill("中文");
		await controller.generateAi();
		expect(generate).not.toHaveBeenCalled();
		expect(controller.getSnapshot().status).toBe("error");
	});
});
