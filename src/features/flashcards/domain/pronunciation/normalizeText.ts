export function normalizePronunciationText(text: string): string {
	return text.normalize("NFC").trim().replace(/\s+/gu, " ");
}
