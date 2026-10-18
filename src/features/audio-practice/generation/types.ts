export interface DraftCue {
	id: string;
	text: string;
	start: number | null;
	end: number | null;
	needsReview: boolean;
}

export interface TimedWord {
	text: string;
	start: number;
	end: number;
}

export interface Transcript {
	cues: DraftCue[];
	words: TimedWord[];
}

export interface AudioChunk {
	index: number;
	start: number;
	end: number;
	wav: ArrayBuffer;
}

export interface PreparedAudio {
	duration: number;
	chunks: AudioChunk[];
}

export interface SpeechConfig {
	workspaceId: string;
	secretId: string;
}

export interface GenerationInput {
	audio: ArrayBuffer;
	name: string;
	referenceText?: string;
	taskKey: string;
	config: SpeechConfig;
}

export type PrepareAudio = (audio: ArrayBuffer, signal: AbortSignal) => Promise<PreparedAudio>;
export type TranscribeAudio = (
	chunk: AudioChunk,
	config: SpeechConfig,
	signal: AbortSignal,
) => Promise<Transcript>;

export interface GenerationDraft {
	taskKey: string;
	fingerprint: string;
	duration: number;
	results: Transcript[];
	cues: DraftCue[];
	complete: boolean;
}

export interface GenerationDraftStore {
	load(key: string): Promise<GenerationDraft | null>;
	save(draft: GenerationDraft): Promise<void>;
}
