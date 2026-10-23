import type { App } from "obsidian";
import type { ShadowSubtitleDocument } from "../domain/shadowSubtitles";
import type { ShadowSubtitleCheckpoint, ShadowSubtitleStore } from "../domain/shadowSubtitlesJobs";
import { validShadowVaultFolder } from "../domain/shadowVaultFolder";
import { ObsidianShadowSubtitleStore } from "./shadowSubtitleStorage";

const FOLDER_KEY = "study-studio.shadowing.source-folders.v1";

/** A video's vault folder stays stable when the default folder setting changes. */
export class ShadowStorageRouter implements ShadowSubtitleStore {
	private readonly roots: Record<string, string>;
	private readonly stores = new Map<string, ObsidianShadowSubtitleStore>();
	private readonly checkpoints: ObsidianShadowSubtitleStore;

	constructor(
		private readonly app: App,
		private readonly preferredRoot: () => string,
	) {
		const saved: unknown = app.loadLocalStorage(FOLDER_KEY);
		this.roots =
			saved && typeof saved === "object" && !Array.isArray(saved)
				? Object.fromEntries(
						Object.entries(saved).filter(
							(entry): entry is [string, string] => typeof entry[1] === "string",
						),
					)
				: {};
		this.checkpoints = new ObsidianShadowSubtitleStore(app);
	}

	rootFor(sourceId: string): string {
		const existing = this.roots[sourceId];
		if (existing) {
			if (!validShadowVaultFolder(existing))
				throw new Error("保存的练习目录无效，请检查本机设置。");
			return existing;
		}
		const root = this.preferredRoot();
		if (!validShadowVaultFolder(root)) throw new Error("练习资料目录必须位于资料库内。");
		this.roots[sourceId] = root;
		this.app.saveLocalStorage(FOLDER_KEY, this.roots);
		return root;
	}

	private storeFor(sourceId: string): ObsidianShadowSubtitleStore {
		const root = this.rootFor(sourceId);
		let store = this.stores.get(root);
		if (!store) {
			store = new ObsidianShadowSubtitleStore(this.app, root);
			this.stores.set(root, store);
		}
		return store;
	}

	load(sourceId: string): Promise<ShadowSubtitleDocument | null> {
		return this.storeFor(sourceId).load(sourceId);
	}

	save(document: ShadowSubtitleDocument): Promise<void> {
		return this.storeFor(document.sourceId).save(document);
	}

	loadCheckpoints(): ShadowSubtitleCheckpoint[] {
		return this.checkpoints.loadCheckpoints();
	}

	saveCheckpoints(checkpoints: ShadowSubtitleCheckpoint[]): void {
		this.checkpoints.saveCheckpoints(checkpoints);
	}
}
