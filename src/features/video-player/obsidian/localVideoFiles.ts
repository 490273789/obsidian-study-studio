import { Platform } from "obsidian";
import type { LocalVideoSource } from "../domain/types";

export interface DesktopVideoFileSystem {
	realpath(path: string): Promise<string>;
	access(path: string, mode?: number): Promise<void>;
}

export interface ElectronWebUtils {
	getPathForFile(file: File): string;
}

export interface LocalVideoFilePickerDependencies {
	document?: Document;
	webUtils?: ElectronWebUtils | null;
	fileSystem?: DesktopVideoFileSystem | null;
	createId?: () => string;
}

/** Opens a native file input and turns selected files into readable external paths. */
export async function pickLocalVideoSources(
	label: string,
	dependencies: LocalVideoFilePickerDependencies = {},
): Promise<LocalVideoSource[]> {
	const document = dependencies.document ?? activeDocument;
	const files = await pickVideoFiles(label, document);
	const webUtils = dependencies.webUtils ?? getElectronWebUtils(document);
	const fileSystem = dependencies.fileSystem ?? getDesktopFileSystem(document);
	return resolveLocalVideoSources(files, { ...dependencies, webUtils, fileSystem });
}

/** Resolves selected browser Files into canonical, readable desktop video sources. */
export async function resolveLocalVideoSources(
	files: readonly File[],
	dependencies: Pick<LocalVideoFilePickerDependencies, "webUtils" | "fileSystem" | "createId">,
): Promise<LocalVideoSource[]> {
	const { webUtils, fileSystem } = dependencies;
	if (!webUtils || !fileSystem) throw new Error("本地视频播放器仅支持 Obsidian 桌面版。");
	const createId = dependencies.createId ?? (() => crypto.randomUUID());
	const settled = await Promise.all(
		files.map(async (file) => {
			const path = webUtils.getPathForFile(file);
			if (!path) return null;
			try {
				const normalized = await fileSystem.realpath(path);
				// Node's R_OK constant. Passing no mode would only check existence (F_OK).
				await fileSystem.access(normalized, 4);
				return { id: createId(), path: normalized, name: file.name };
			} catch {
				return null;
			}
		}),
	);
	const knownPaths = new Set<string>();
	return settled.filter(
		(source): source is LocalVideoSource =>
			!!source && !knownPaths.has(source.path) && (knownPaths.add(source.path), true),
	);
}

export function localVideoMediaUrl(
	path: string,
	resourcePathPrefix = Platform.resourcePathPrefix,
): string {
	const normalized = path.replaceAll("\\", "/").replace(/^\/+/, "");
	const encoded = normalized
		.split("/")
		.map((segment) => encodeURIComponent(segment).replaceAll("%3A", ":"))
		.join("/");
	return `${resourcePathPrefix.replace(/\/$/, "")}/${encoded}`;
}

function pickVideoFiles(label: string, document: Document): Promise<File[]> {
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.multiple = true;
		input.accept = "video/*";
		input.style.display = "none";
		input.setAttribute("aria-label", label);
		const finish = (files: File[]): void => {
			input.remove();
			resolve(files);
		};
		input.addEventListener("change", () => finish([...(input.files ?? [])]), { once: true });
		input.addEventListener("cancel", () => finish([]), { once: true });
		document.body.append(input);
		input.click();
	});
}

function getElectronWebUtils(document: Document): ElectronWebUtils | null {
	const requireModule = (
		document.defaultView as (Window & { require?: (id: string) => unknown }) | null
	)?.require;
	if (!requireModule) return null;
	try {
		return (requireModule("electron") as { webUtils?: ElectronWebUtils }).webUtils ?? null;
	} catch {
		return null;
	}
}
function getDesktopFileSystem(document: Document): DesktopVideoFileSystem | null {
	const requireModule = (
		document.defaultView as (Window & { require?: (id: string) => unknown }) | null
	)?.require;
	if (!requireModule) return null;
	try {
		const fs = requireModule("node:fs/promises") as Partial<DesktopVideoFileSystem>;
		return typeof fs.realpath === "function" && typeof fs.access === "function"
			? (fs as DesktopVideoFileSystem)
			: null;
	} catch {
		return null;
	}
}
