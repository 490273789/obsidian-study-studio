type LocalDictionaryPickerKind = "files" | "folder";

/**
 * Open the browser-backed picker in Obsidian's currently active document.
 *
 * Obsidian can render settings in a secondary window. Using the module's
 * global `document` creates the input in the main window instead, so Electron
 * rejects its synthetic click because the user activation belongs to another
 * document.
 */
export function pickLocalDictionaryFiles(
	kind: LocalDictionaryPickerKind,
	label: string,
	document: Document = activeDocument,
): Promise<File[]> {
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.multiple = true;
		input.style.display = "none";
		input.setAttribute("aria-label", label);
		if (kind === "folder") input.setAttribute("webkitdirectory", "");
		else input.accept = ".eudic,.mdx,.mdd,.css,.js";
		const finish = (files: File[]): void => {
			input.remove();
			resolve(files);
		};
		input.addEventListener("change", () => finish([...(input.files ?? [])]), {
			once: true,
		});
		input.addEventListener("cancel", () => finish([]), { once: true });
		document.body.append(input);
		input.click();
	});
}
