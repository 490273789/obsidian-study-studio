import type { AiFailureCode } from "../../../core/ai";

type TranslationDirection = "zh-en" | "en-zh";
export interface TranslationProfile {
	id: string;
	name: string;
	enabled: boolean;
	kind: "engine" | "youdao";
	configId: string;
}
export interface TranslationSettings {
	enabled: boolean;
	direction: TranslationDirection;
	profiles: TranslationProfile[];
	promptTemplate: string;
	thinkingEnabled: boolean;
	youdao: { baseUrl: string; appKeySecretId: string; appSecretSecretId: string };
}
export interface TranslationOutput {
	text: string;
	usage?: { inputTokens: number | null; outputTokens: number | null } | null;
}
export interface TranslationResultState extends TranslationOutput {
	id: string;
	name: string;
	model: string;
	provider: string;
	status: "idle" | "loading" | "success" | "error";
	error?: AiFailureCode;
}
export interface TranslationSnapshot {
	settings: TranslationSettings;
	input: string;
	results: readonly TranslationResultState[];
	status: "idle" | "loading" | "success" | "error";
	error?: AiFailureCode;
	saving: boolean;
	testing: boolean;
}
