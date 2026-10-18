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

export interface GenerationInput {
	audio: ArrayBuffer;
	name: string;
	referenceText?: string;
	taskKey: string;
	config: TranscriptionConfig;
}

export type PrepareAudio = (audio: ArrayBuffer, signal: AbortSignal) => Promise<PreparedAudio>;
export type TranscribeAudio = (
	chunk: AudioChunk,
	config: TranscriptionConfig,
	signal: AbortSignal,
) => Promise<Transcript>;

/**
 * A non-fatal generation outcome shown after review starts. The UI owns the
 * localized text so the domain module never depends on settings copy.
 */
export type GenerationNotice = "no-word-timestamps";

export interface GenerationDraft {
	taskKey: string;
	/** Audio bytes plus reference text; source identity independent of the service. */
	fingerprint: string;
	/** Provider/model identity so a different service never resumes old results. */
	configFingerprint: string;
	duration: number;
	results: Transcript[];
	cues: DraftCue[];
	complete: boolean;
	notice: GenerationNotice | null;
}

export interface GenerationDraftStore {
	load(key: string): Promise<GenerationDraft | null>;
	save(draft: GenerationDraft): Promise<void>;
}

/** Size and modification time of an audio source, read through a vault adapter. */
export interface AudioSourceStat {
	readonly size: number;
	readonly mtime: number;
}

/**
 * Vault-backed identity of an audio source. Injected so the subtitle workflow
 * never reaches for Obsidian itself.
 */
export interface AudioSourceFiles {
	stat(path: string): AudioSourceStat | null;
	readBinary(path: string): Promise<ArrayBuffer>;
}
