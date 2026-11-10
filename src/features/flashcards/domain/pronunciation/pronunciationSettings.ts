import { settingsRecord, type SettingsSlice } from "../../../../core/settings/slice";
import type {
	PronunciationAccent,
	PronunciationRate,
	PronunciationSettings,
} from "../../../../core/shared/types";

/**
 * Defaults live with the slice that owns them, not in the settings document
 * aggregate: reading the aggregate from here would make the normalizer depend on
 * the document it feeds.
 */
const DEFAULT_PRONUNCIATION_SETTINGS: PronunciationSettings = {
	spellingAutoPlay: false,
	accent: "system",
	rate: "normal",
};

const PRONUNCIATION_ACCENTS = new Set<PronunciationAccent>(["system", "en-US", "en-GB"]);
const PRONUNCIATION_RATES = new Set<PronunciationRate>(["normal", "slow"]);

/** Normalizes persisted pronunciation preferences; the argument is untrusted. */
export function normalizePronunciationSettings(value: unknown): PronunciationSettings {
	const settings: Partial<PronunciationSettings> =
		typeof value === "object" && value !== null
			? (value as Partial<PronunciationSettings>)
			: {};
	const defaults = DEFAULT_PRONUNCIATION_SETTINGS;
	const accent = PRONUNCIATION_ACCENTS.has(settings?.accent as PronunciationAccent)
		? (settings?.accent as PronunciationAccent)
		: defaults.accent;
	const rate = PRONUNCIATION_RATES.has(settings?.rate as PronunciationRate)
		? (settings?.rate as PronunciationRate)
		: defaults.rate;

	return {
		spellingAutoPlay:
			typeof settings?.spellingAutoPlay === "boolean"
				? settings.spellingAutoPlay
				: defaults.spellingAutoPlay,
		accent,
		rate,
	};
}

/** The 闪卡 feature's pronunciation preferences slice. */
export const pronunciationSettingsSlice: SettingsSlice<{ pronunciation: PronunciationSettings }> = {
	id: "pronunciation",
	keys: ["pronunciation"],

	defaults: () => ({ pronunciation: { ...DEFAULT_PRONUNCIATION_SETTINGS } }),

	normalize: (raw) => ({
		pronunciation: normalizePronunciationSettings(settingsRecord(raw).pronunciation),
	}),

	clone: (document) => ({ pronunciation: { ...document.pronunciation } }),
};
