/**
 * Fisher-Yates shuffle — returns a new array with elements in random order.
 * Produces an unbiased permutation, unlike sort(() => Math.random() - 0.5).
 */
export function shuffleArray<T>(arr: readonly T[]): T[] {
	const result = [...arr];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[result[i], result[j]] = [result[j]!, result[i]!];
	}
	return result;
}

/** Keeps only string entries from an untrusted array-shaped value. */
export function normalizeStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

/** Positional equality for string arrays; order matters. */
export function stringArrayEquals(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Readable message for an unknown thrown value. */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Narrows an untrusted JSON number, rejecting non-finite values. */
export function finiteNumberOrNull(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Clamps a numeric value to the inclusive [min, max] range. */
export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/** Escapes HTML special characters for safe text interpolation. */
export function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}
