import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { App, Plugin } from "obsidian";
import type {
	CompiledPackagePublication,
	CompiledPackagePublisher,
} from "../compiled-package/types";
import { CompiledPackageError } from "../compiled-package/types";
import { LocalDictionaryImporter } from "../importer";
import { DictionaryImportRecovery } from "../import-recovery";

vi.mock("obsidian", () => ({
	Platform: { isDesktopApp: true },
	FileSystemAdapter: class {
		getBasePath() {
			return "";
		}
	},
}));
vi.mock("../compiled-package", async () => ({
	...(await import("../compiled-package/types")),
	createCompiledPackagePublisher: vi.fn(),
}));

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

function publication() {
	return {
		metadata: {
			formatVersion: 2,
			engineVersion: "2.0.6",
			entryCount: 1,
			fileCount: 1,
			manifestPath: "compiled-v2/manifest.json",
			manifestSha256: "a".repeat(64),
			sourceFingerprint: "b".repeat(64),
			totalBytes: 1,
		},
		commit: vi.fn(),
		rollback: vi.fn(async () => undefined),
	} satisfies CompiledPackagePublication;
}

async function fixture(publish: CompiledPackagePublisher["publish"]) {
	const base = await mkdtemp(join(tmpdir(), "dictionary-recovery-test-"));
	directories.push(base);
	const { FileSystemAdapter } = await import("obsidian");
	const adapter = new FileSystemAdapter();
	vi.spyOn(adapter, "getBasePath").mockReturnValue(base);
	const app = {
		vault: { adapter, configDir: ".obsidian" },
	} as unknown as App;
	const plugin = { manifest: { id: "test" } } as Plugin;
	return {
		importer: new LocalDictionaryImporter(app, plugin, { publish, close: vi.fn() }),
		root: `${base}/.obsidian/plugins/test/dictionaries`,
	};
}
const plans = (ids = ["first", "second"]) =>
	ids.map((id) => ({ id, format: "mdict" as const, files: [new File(["source"], `${id}.mdx`)] }));

describe("dictionary import recovery", () => {
	it("removes all owned directories after a later publication fails, preserving existing dictionaries", async () => {
		const first = publication();
		const publish = vi
			.fn<CompiledPackagePublisher["publish"]>()
			.mockResolvedValueOnce(first)
			.mockRejectedValueOnce(new CompiledPackageError("corrupt"));
		const { importer, root } = await fixture(publish);
		await mkdir(`${root}/existing`, { recursive: true });
		await writeFile(`${root}/existing/keep`, "original");
		await expect(importer.stageImport(plans())).rejects.toMatchObject({ code: "corrupt" });
		expect(await readdir(root)).toEqual(["existing"]);
		expect(await readFile(`${root}/existing/keep`, "utf8")).toBe("original");
		expect(first.rollback).toHaveBeenCalledOnce();
	});

	it("never claims or removes a colliding directory", async () => {
		const publish = vi.fn<CompiledPackagePublisher["publish"]>();
		const { importer, root } = await fixture(publish);
		await mkdir(`${root}/first`, { recursive: true });
		await expect(importer.stageImport(plans())).rejects.toMatchObject({ code: "collision" });
		expect(await readdir(root)).toEqual(["first"]);
		expect(publish).not.toHaveBeenCalled();
	});

	it("rolls back cancellation arriving during the final publication", async () => {
		const controller = new AbortController();
		const published = publication();
		const { importer, root } = await fixture(async () => {
			controller.abort();
			return published;
		});
		await expect(
			importer.stageImport(plans(["first"]), undefined, controller.signal),
		).rejects.toMatchObject({ code: "cancelled" });
		expect(await readdir(root)).toEqual([]);
		expect(published.rollback).toHaveBeenCalledOnce();
	});

	it("does not mask publisher recovery failure with cancellation", async () => {
		const controller = new AbortController();
		const { importer, root } = await fixture(async () => {
			controller.abort();
			throw new CompiledPackageError("recovery-incomplete");
		});
		await expect(
			importer.stageImport(plans(["first"]), undefined, controller.signal),
		).rejects.toMatchObject({ code: "recovery-incomplete" });
		expect(await readdir(root)).toEqual([]);
	});

	it("keeps committed files and makes rollback idempotent", async () => {
		const { importer, root } = await fixture(async () => publication());
		const committed = await importer.stageImport(plans(["first"]));
		committed.commit();
		await committed.rollback();
		expect(await readdir(root)).toEqual(["first"]);
		const discarded = await importer.stageImport(plans(["second"]));
		await discarded.rollback();
		await discarded.rollback();
		discarded.commit();
		expect(await readdir(root)).toEqual(["first"]);
	});

	it("waits for every cleanup and attempts directory removal even when package rollback fails", async () => {
		let release!: () => void;
		const slow = new Promise<void>((resolve) => {
			release = resolve;
		});
		const removed: string[] = [];
		const recovery = new DictionaryImportRecovery({
			mkdir: async () => undefined,
			rm: async (path) => {
				if (path === "slow") await slow;
				removed.push(path);
			},
		});
		await recovery.stage("failed", async () => ({
			...publication(),
			rollback: async () => {
				throw new Error("denied");
			},
		}));
		await recovery.stage("slow", async () => publication());
		const rollback = recovery.rollback();
		expect(recovery.rollback()).toBe(rollback);
		let settled = false;
		const outcome = rollback.catch((error: unknown) => {
			settled = true;
			return error;
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(removed).toEqual(["failed"]);
		expect(settled).toBe(false);
		release();
		expect(await outcome).toMatchObject({ code: "recovery-incomplete" });
		expect(removed).toEqual(["failed", "slow"]);
	});
});
