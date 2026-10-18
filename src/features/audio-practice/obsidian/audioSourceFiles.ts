import { TFile, normalizePath, type App } from "obsidian";
import type { AudioSourceFiles } from "../generation/types";

/** Vault-backed source identity for the subtitle workflow; no Obsidian types escape. */
export function createAudioSourceFiles(app: App): AudioSourceFiles {
	const fileAt = (path: string): TFile | null => {
		const file = app.vault.getAbstractFileByPath(normalizePath(path));
		return file instanceof TFile ? file : null;
	};
	return {
		stat(path) {
			const file = fileAt(path);
			return file ? { size: file.stat.size, mtime: file.stat.mtime } : null;
		},
		async readBinary(path) {
			const file = fileAt(path);
			if (!file) throw new Error("file-missing");
			return app.vault.readBinary(file);
		},
	};
}
