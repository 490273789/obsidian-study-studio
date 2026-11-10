import type { PronunciationSettings } from "../../../../core/shared/types";

type PronunciationSource = "local";

export type PronunciationFailureReason = "not-configured" | "playback" | "unsupported";

export type PronunciationManagementAction = "configuring";

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

export interface PronunciationSnapshot {
	readonly revision: number;
	readonly settings: Readonly<PronunciationSettings>;
	readonly management: "idle" | PronunciationManagementAction;
	readonly hasLocalEnglishVoice: boolean;
	readonly voicesLoaded: boolean;
	readonly speakingText: string | null;
}

export interface PronunciationRuntime {
	getSnapshot(): PronunciationSnapshot;
	subscribe(listener: () => void): () => void;
	configure(patch: Partial<PronunciationSettings>): Promise<PronunciationConfigureOutcome>;
	canSpeak(text: string): Promise<boolean>;
	speak(text: string, intent: "manual" | "auto"): Promise<PronunciationOutcome>;
	stop(): void;
	dispose(): void;
}
