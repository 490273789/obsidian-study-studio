export const DEFAULT_OPEN_MAIN_SHORTCUT = "Ctrl+Enter";

const MODIFIERS = ["Ctrl", "Alt", "Shift", "Meta"] as const;
type Modifier = (typeof MODIFIERS)[number];

/** Popup shortcuts always need a non-Shift modifier so typing keeps working. */
export function parseOpenMainShortcut(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const parts = value.split("+");
	const rawKey = parts.pop();
	if (!rawKey || !/^[A-Za-z][A-Za-z0-9]*$|^[0-9]$/.test(rawKey)) return null;
	const key = rawKey.length === 1 ? rawKey.toUpperCase() : rawKey;
	if (key === "Escape" || MODIFIERS.includes(key as Modifier)) return null;
	const modifiers = new Set<Modifier>();
	for (const part of parts) {
		if (!MODIFIERS.includes(part as Modifier) || modifiers.has(part as Modifier)) return null;
		modifiers.add(part as Modifier);
	}
	if (!modifiers.has("Ctrl") && !modifiers.has("Alt") && !modifiers.has("Meta")) return null;
	return [...MODIFIERS.filter((modifier) => modifiers.has(modifier)), key].join("+");
}

export function normalizeOpenMainShortcut(value: unknown): string {
	return parseOpenMainShortcut(value) ?? DEFAULT_OPEN_MAIN_SHORTCUT;
}

export function matchesOpenMainShortcut(event: KeyboardEvent, shortcut: string): boolean {
	const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
	const recorded = [
		event.ctrlKey ? "Ctrl" : null,
		event.altKey ? "Alt" : null,
		event.shiftKey ? "Shift" : null,
		event.metaKey ? "Meta" : null,
		key === " " ? "Space" : key === "+" ? "Plus" : key === "-" ? "Minus" : key,
	]
		.filter((part): part is string => part !== null)
		.join("+");
	return recorded === shortcut;
}
