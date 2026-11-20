/**
 * Safely copies text to the system clipboard across desktop and mobile Obsidian environments.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
	if (!text) return false;

	if (typeof navigator !== "undefined" && navigator?.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			// Fall through to fallback
		}
	}

	if (typeof document !== "undefined") {
		let textArea: HTMLTextAreaElement | undefined;
		try {
			textArea = document.createElement("textarea");
			textArea.value = text;
			textArea.style.position = "fixed";
			textArea.style.left = "-9999px";
			textArea.style.top = "-9999px";
			textArea.setAttribute("readonly", "");
			document.body.appendChild(textArea);
			textArea.focus();
			textArea.select();
			return document.execCommand("copy");
		} catch {
			return false;
		} finally {
			textArea?.remove();
		}
	}

	return false;
}
