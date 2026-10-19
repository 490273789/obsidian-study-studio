import type { Hotkey, Modifier } from "obsidian";
import { settingsRecord, type SettingsSlice } from "./slice";

export const FEATURE_OPEN_SHORTCUT_KEYS = [
	"selectionHelper",
	"videoPlayer",
	"dictionary",
	"flashcards",
	"audioPractice",
] as const;

export type FeatureOpenShortcutKey = (typeof FEATURE_OPEN_SHORTCUT_KEYS)[number];
export type FeatureOpenShortcuts = Record<FeatureOpenShortcutKey, string>;

export const DEFAULT_FEATURE_OPEN_SHORTCUTS: FeatureOpenShortcuts = {
	selectionHelper: "Alt+1",
	videoPlayer: "Alt+2",
	dictionary: "Alt+3",
	flashcards: "Alt+4",
	audioPractice: "Alt+5",
};

const MODIFIERS = ["Ctrl", "Alt", "Shift", "Meta"] as const;
const NAMED_KEYS = new Set([
	"Space",
	"Plus",
	"Minus",
	"Enter",
	"Tab",
	"Backspace",
	"Delete",
	"Insert",
	"Home",
	"End",
	"PageUp",
	"PageDown",
	"ArrowUp",
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
]);

/** Global entry shortcuts require a non-Shift modifier so ordinary typing stays available. */
export function normalizeFeatureOpenShortcut(value: unknown): string | null {
	if (value === "") return "";
	if (typeof value !== "string") return null;
	const parts = value.split("+");
	const key = parts.pop();
	if (!key || key === "Escape" || key === "Esc" || key.trim() !== key) return null;
	if (!/^[A-Z0-9]$/.test(key) && !/^F(?:[1-9]|1\d|2[0-4])$/.test(key) && !NAMED_KEYS.has(key))
		return null;
	const modifiers = new Set<string>();
	for (const part of parts) {
		if (!MODIFIERS.includes(part as (typeof MODIFIERS)[number]) || modifiers.has(part))
			return null;
		modifiers.add(part);
	}
	if (!modifiers.has("Ctrl") && !modifiers.has("Alt") && !modifiers.has("Meta")) return null;
	return [...MODIFIERS.filter((modifier) => modifiers.has(modifier)), key].join("+");
}

export function featureOpenHotkeys(shortcut: string): Hotkey[] {
	const normalized = normalizeFeatureOpenShortcut(shortcut);
	if (!normalized) return [];
	const parts = normalized.split("+");
	const key = parts.pop()!;
	return [{ modifiers: parts as Modifier[], key }];
}

export function conflictingFeatureOpenShortcut(
	shortcuts: FeatureOpenShortcuts,
	key: FeatureOpenShortcutKey,
	shortcut: string,
): FeatureOpenShortcutKey | null {
	if (!shortcut) return null;
	return (
		FEATURE_OPEN_SHORTCUT_KEYS.find(
			(other) => other !== key && shortcuts[other] === shortcut,
		) ?? null
	);
}

function normalizeFeatureOpenShortcuts(value: unknown): FeatureOpenShortcuts {
	const source = settingsRecord(value);
	const result = { ...DEFAULT_FEATURE_OPEN_SHORTCUTS };
	const used = new Set<string>();
	for (const key of FEATURE_OPEN_SHORTCUT_KEYS) {
		const shortcut = normalizeFeatureOpenShortcut(source[key]);
		const selected = shortcut === null ? DEFAULT_FEATURE_OPEN_SHORTCUTS[key] : shortcut;
		result[key] = selected && used.has(selected) ? "" : selected;
		if (result[key]) used.add(result[key]);
	}
	return result;
}

export const featureOpenShortcutsSlice: SettingsSlice<{
	featureOpenShortcuts: FeatureOpenShortcuts;
}> = {
	id: "feature-open-shortcuts",
	keys: ["featureOpenShortcuts"],
	defaults: () => ({ featureOpenShortcuts: { ...DEFAULT_FEATURE_OPEN_SHORTCUTS } }),
	normalize: (raw) => ({
		featureOpenShortcuts: normalizeFeatureOpenShortcuts(
			settingsRecord(raw).featureOpenShortcuts,
		),
	}),
	clone: (document) => ({ featureOpenShortcuts: { ...document.featureOpenShortcuts } }),
};
