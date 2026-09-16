export interface VideoPlayerShortcuts {
	readonly togglePlayback: string;
	readonly seekBackward: string;
	readonly seekForward: string;
}

export const DEFAULT_VIDEO_PLAYER_SHORTCUTS: VideoPlayerShortcuts = {
	togglePlayback: "Space",
	seekBackward: "ArrowLeft",
	seekForward: "ArrowRight",
};

const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Meta"] as const;
const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta"]);

export interface KeyboardShortcutEvent {
	readonly key: string;
	readonly ctrlKey: boolean;
	readonly altKey: boolean;
	readonly shiftKey: boolean;
	readonly metaKey: boolean;
}

export function keyboardShortcutFromEvent(event: KeyboardShortcutEvent): string | null {
	if (MODIFIER_KEYS.has(event.key)) return null;
	const key = normalizeEventKey(event.key);
	if (!key) return null;
	const modifiers = [
		event.ctrlKey ? "Ctrl" : null,
		event.altKey ? "Alt" : null,
		event.shiftKey ? "Shift" : null,
		event.metaKey ? "Meta" : null,
	].filter((value): value is (typeof MODIFIER_ORDER)[number] => value !== null);
	return [...modifiers, key].join("+");
}

export function matchesKeyboardShortcut(event: KeyboardShortcutEvent, shortcut: string): boolean {
	const parsed = parseKeyboardShortcut(shortcut);
	if (!parsed) return false;
	return (
		parsed.key === normalizeEventKey(event.key) &&
		parsed.modifiers.has("Ctrl") === event.ctrlKey &&
		parsed.modifiers.has("Alt") === event.altKey &&
		parsed.modifiers.has("Shift") === event.shiftKey &&
		parsed.modifiers.has("Meta") === event.metaKey
	);
}

export function normalizeKeyboardShortcut(value: unknown, fallback: string): string {
	if (value === "") return "";
	if (typeof value !== "string") return fallback;
	const parsed = parseKeyboardShortcut(value);
	if (!parsed) return fallback;
	return [
		...MODIFIER_ORDER.filter((modifier) => parsed.modifiers.has(modifier)),
		parsed.key,
	].join("+");
}

export function hasDuplicateShortcuts(shortcuts: VideoPlayerShortcuts): boolean {
	const assigned = Object.values(shortcuts).filter((shortcut) => shortcut !== "");
	return new Set(assigned).size !== assigned.length;
}

function parseKeyboardShortcut(
	value: string,
): { modifiers: ReadonlySet<(typeof MODIFIER_ORDER)[number]>; key: string } | null {
	const parts = value.split("+");
	const key = parts.pop();
	if (!key || key.trim() !== key || MODIFIER_ORDER.includes(key as never)) return null;
	const modifiers = new Set<(typeof MODIFIER_ORDER)[number]>();
	for (const part of parts) {
		if (!MODIFIER_ORDER.includes(part as never) || modifiers.has(part as never)) return null;
		modifiers.add(part as (typeof MODIFIER_ORDER)[number]);
	}
	return { modifiers, key: normalizeEventKey(key) ?? key };
}

function normalizeEventKey(key: string): string | null {
	if (key === " " || key === "Spacebar" || key === "Space") return "Space";
	if (key === "+") return "Plus";
	if (key === "-") return "Minus";
	if (key.length === 1) return key.toUpperCase();
	return key || null;
}
