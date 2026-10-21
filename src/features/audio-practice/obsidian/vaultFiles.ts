import { TFile, normalizePath, type App } from "obsidian";
import { audioFailure } from "../domain/failures";
import type {
	AudioPracticeCatalog,
	AudioPracticeFileCatalog,
	AudioPracticeFiles,
	AudioFileChange,
} from "../domain/types";

/** Vault APIs work on mobile as well as desktop; absolute OS paths never escape here. */
export function createAudioPracticeFiles(app: App): AudioPracticeFiles {
	const fileAt = (path: string): TFile => {
		const file = app.vault.getAbstractFileByPath(normalizePath(path));
		if (!(file instanceof TFile)) throw audioFailure({ kind: "missing-file" });
		return file;
	};
	return {
		readText: (path) => app.vault.read(fileAt(path)),
		stat: (path) => {
			const file = app.vault.getAbstractFileByPath(normalizePath(path));
			return file instanceof TFile ? { size: file.stat.size, mtime: file.stat.mtime } : null;
		},
		mediaUrl: (path) => app.vault.getResourcePath(fileAt(path)),
		exists: (path) => app.vault.getAbstractFileByPath(normalizePath(path)) instanceof TFile,
		async writeSubtitle(audioPath, contents) {
			const base = audioPath.replace(/\.[^/.]+$/, "");
			let suffix = 0;
			let path: string;
			do {
				path = normalizePath(`${base}.practice${suffix ? `-${suffix}` : ""}.srt`);
				suffix++;
			} while (app.vault.getAbstractFileByPath(path));
			await app.vault.create(path, contents);
			return path;
		},
		subscribe(listener: (event: AudioFileChange) => void) {
			const refs = [
				app.vault.on("rename", (file, oldPath) =>
					listener({ kind: "rename", path: oldPath, nextPath: file.path }),
				),
				app.vault.on("modify", (file) => listener({ kind: "change", path: file.path })),
				app.vault.on("delete", (file) => listener({ kind: "delete", path: file.path })),
				app.vault.on("create", (file) => listener({ kind: "create", path: file.path })),
			];
			return () => refs.forEach((ref) => app.vault.offref(ref));
		},
	};
}

/** Lists the picker's file world and refreshes it when vault paths change. */
export function createAudioPracticeCatalog(app: App): AudioPracticeCatalog {
	return {
		list: () => listAudioPracticeFiles(app),
		subscribe(listener) {
			const refs = [
				app.vault.on("create", () => listener()),
				app.vault.on("rename", () => listener()),
				app.vault.on("delete", () => listener()),
			];
			return () => refs.forEach((ref) => app.vault.offref(ref));
		},
	};
}

function listAudioPracticeFiles(app: App): AudioPracticeFileCatalog {
	const files = app.vault.getFiles();
	const paths = (extensions: string[]) =>
		files
			.filter((file) => extensions.includes(file.extension.toLowerCase()))
			.map((file) => file.path)
			.sort();
	return {
		audioPaths: paths(["mp3", "m4a", "wav"]),
		subtitlePaths: paths(["srt", "vtt"]),
		textPaths: paths(["md", "txt"]),
	};
}
