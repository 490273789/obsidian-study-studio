import type {
	OnlinePronunciationProvider,
	PronunciationAccent,
	PronunciationRate,
	PronunciationSettings,
} from "../../../../core/shared/types";

type PronunciationSource = "local" | "cache" | "azure" | "openai";

export type PronunciationFailureReason =
	| "offline"
	| "not-configured"
	| "unauthorized"
	| "quota"
	| "network"
	| "timeout"
	| "playback"
	| "unsupported";

export type PronunciationManagementAction = "configuring" | "testing-provider" | "clearing-cache";

export type PronunciationOutcome =
	| {
			status: "success";
			source: PronunciationSource;
	  }
	| {
			status: "unavailable";
			reason: PronunciationFailureReason;
	  }
	| {
			status: "failed";
			reason: PronunciationFailureReason;
	  }
	| {
			status: "cancelled";
	  };

export type PronunciationTestOutcome =
	| PronunciationOutcome
	| {
			status: "busy";
			operation: PronunciationManagementAction;
	  };

export type PronunciationConfigureOutcome =
	| {
			status: "applied";
			settings: PronunciationSettings;
	  }
	| {
			status: "busy";
			operation: PronunciationManagementAction;
	  }
	| {
			status: "failed";
			reason: "persistence";
	  };

export type PronunciationCacheClearOutcome =
	| {
			status: "cleared";
	  }
	| {
			status: "busy";
			operation: PronunciationManagementAction;
	  }
	| {
			status: "failed";
			reason: "storage";
	  };

export type PronunciationCacheUsage =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly bytes: number }
	| { readonly status: "failed" };

export interface PronunciationSnapshot {
	readonly revision: number;
	readonly settings: Readonly<PronunciationSettings>;
	readonly management: "idle" | PronunciationManagementAction;
	readonly hasLocalEnglishVoice: boolean;
	readonly voicesLoaded: boolean;
	readonly speakingText: string | null;
	readonly cacheUsage: PronunciationCacheUsage;
}

export interface PronunciationRequestDescriptor {
	provider: Exclude<OnlinePronunciationProvider, "none">;
	text: string;
	accent: Exclude<PronunciationAccent, "system">;
	rate: PronunciationRate;
	variant: string;
}

export interface SynthesizedAudio {
	data: ArrayBuffer;
	mimeType: string;
	source: Exclude<PronunciationSource, "local" | "cache">;
}

export interface PronunciationRuntime {
	getSnapshot(): PronunciationSnapshot;
	subscribe(listener: () => void): () => void;
	configure(patch: Partial<PronunciationSettings>): Promise<PronunciationConfigureOutcome>;
	canSpeak(text: string): Promise<boolean>;
	speak(text: string, intent: "manual" | "auto"): Promise<PronunciationOutcome>;
	testOnlineProvider(text: string): Promise<PronunciationTestOutcome>;
	stop(): void;
	refreshCacheUsage(): Promise<PronunciationCacheUsage>;
	clearCache(): Promise<PronunciationCacheClearOutcome>;
	dispose(): void;
}

export interface CachedPronunciationAudio {
	data: ArrayBuffer;
	mimeType: string;
}

export interface PronunciationAudioCache {
	get(key: string): Promise<CachedPronunciationAudio | null>;
	put(key: string, audio: CachedPronunciationAudio): Promise<void>;
	getUsageBytes(): Promise<number>;
	clear(): Promise<void>;
}

export const PRONUNCIATION_CACHE_LIMIT_BYTES = 100 * 1024 * 1024;
export const PRONUNCIATION_CACHE_LIMIT_BYTES_MOBILE = 16 * 1024 * 1024;
