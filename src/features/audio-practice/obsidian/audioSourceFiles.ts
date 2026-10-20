import { TFile, normalizePath, type App } from "obsidian";
import { audioFailure } from "../domain/failures";
import type { AudioSourceFiles } from "../domain/transcriptionTypes";

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
			if (!file) throw audioFailure({ kind: "missing-file" });
			return app.vault.readBinary(file);
		},
	};
}
