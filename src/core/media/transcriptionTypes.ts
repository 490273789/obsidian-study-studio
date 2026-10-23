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

export interface TimedTextWord {
	startOffset: number;
	endOffset: number;
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

export type TranscriptionProviderId = "bailian" | "openai-compatible";

/** Alibaba Cloud Model Studio synchronous speech-recognition contract. */
export interface BailianTranscriptionConfig {
	provider: "bailian";
	/** Workspace-scoped endpoint host prefix; the region stays fixed to Beijing. */
	workspaceId: string;
	/** Obsidian SecretStorage identifier; never the API key itself. */
	secretId: string;
	model: string;
}

/** Standard `POST {baseUrl}/audio/transcriptions` contract (OpenAI, Groq, gateways). */
export interface OpenAiCompatibleTranscriptionConfig {
	provider: "openai-compatible";
	/** Base URL up to the API root, e.g. `https://api.openai.com/v1`. */
	baseUrl: string;
	/** Obsidian SecretStorage identifier; never the API key itself. */
	secretId: string;
	model: string;
}

export type TranscriptionConfig = BailianTranscriptionConfig | OpenAiCompatibleTranscriptionConfig;

export type TranscribeAudio = (
	chunk: AudioChunk,
	config: TranscriptionConfig,
	signal: AbortSignal,
) => Promise<Transcript>;
