import { settingsRecord, type SettingsSlice } from "../../../../core/settings/slice";
import type {
	OnlinePronunciationProvider,
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
	onlineProvider: "none",
	azureCloud: "china",
	azureRegion: "chinaeast2",
	azureSecretId: "",
	openaiSecretId: "",
};

const PRONUNCIATION_ACCENTS = new Set<PronunciationAccent>(["system", "en-US", "en-GB"]);
const PRONUNCIATION_RATES = new Set<PronunciationRate>(["normal", "slow"]);
const ONLINE_PROVIDERS = new Set<OnlinePronunciationProvider>(["none", "azure", "openai"]);
export const AZURE_CHINA_REGIONS = new Set(["chinaeast2", "chinanorth2", "chinanorth3"]);

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
	const onlineProvider = ONLINE_PROVIDERS.has(
		settings?.onlineProvider as OnlinePronunciationProvider,
	)
		? (settings?.onlineProvider as OnlinePronunciationProvider)
		: defaults.onlineProvider;
	const azureCloud = settings?.azureCloud === "global" ? "global" : "china";
	let azureRegion =
		typeof settings?.azureRegion === "string"
			? settings.azureRegion.trim().toLowerCase()
			: defaults.azureRegion;

	if (azureCloud === "china" && !AZURE_CHINA_REGIONS.has(azureRegion)) {
		azureRegion = "chinaeast2";
	}
	if (azureCloud === "global" && AZURE_CHINA_REGIONS.has(azureRegion)) {
		azureRegion = "eastus";
	}

	return {
		spellingAutoPlay:
			typeof settings?.spellingAutoPlay === "boolean"
				? settings.spellingAutoPlay
				: defaults.spellingAutoPlay,
		accent,
		rate,
		onlineProvider,
		azureCloud,
		azureRegion,
		azureSecretId:
			typeof settings?.azureSecretId === "string"
				? settings.azureSecretId
				: defaults.azureSecretId,
		openaiSecretId:
			typeof settings?.openaiSecretId === "string"
				? settings.openaiSecretId
				: defaults.openaiSecretId,
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
