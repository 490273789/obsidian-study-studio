import type { AiFailureCode } from "../../../core/ai";

export type TranslationDirection = "zh-en" | "en-zh";
export interface TranslationProfile {
	id: string;
	name: string;
	enabled: boolean;
	/** Shared AI engine registry identity; an empty id means "not configured yet". */
	engineId: string;
}
export interface TranslationSettings {
	enabled: boolean;
	direction: TranslationDirection;
	profiles: TranslationProfile[];
	promptTemplate: string;
	thinkingEnabled: boolean;
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
	setupIssue?: "engineSetup";
	status: "idle" | "loading" | "success" | "error";
	error?: AiFailureCode;
}
export interface TranslationSnapshot {
	settings: TranslationSettings;
	input: string;
	/** Input that produced the currently visible results. */
	translatedInput: string;
	/** Direction that produced the currently visible results. */
	translatedDirection: TranslationDirection;
	/** Results exist but the input or direction has changed since they were produced. */
	stale: boolean;
	clearUndoId: number | null;
	results: readonly TranslationResultState[];
	status: "idle" | "loading" | "success" | "error";
	error?: AiFailureCode;
	saving: boolean;
}
