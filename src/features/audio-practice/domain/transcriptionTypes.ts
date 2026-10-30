import type {
	AudioChunk,
	Transcript,
	DraftCue,
	TimedWord,
	TimedTextWord,
	TranscriptionProviderId,
} from "../../../core/media/transcriptionTypes";
export type { DraftCue, TimedWord, TimedTextWord, Transcript, AudioChunk, TranscriptionProviderId };

interface PreparedAudio {
	duration: number;
	chunks: AudioChunk[];
}

export interface GenerationInput {
	audio: ArrayBuffer;
	name: string;
	referenceText?: string;
	taskKey: string;
	config?: unknown;
}

export type PrepareAudio = (audio: ArrayBuffer, signal: AbortSignal) => Promise<PreparedAudio>;
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
	/** Deduplicated audio-global word timings from the completed transcription. */
	words?: TimedWord[];
	cues: DraftCue[];
	complete: boolean;
	notice: GenerationNotice | null;
}

export interface GenerationDraftStore {
	load(key: string): Promise<GenerationDraft | null>;
	save(draft: GenerationDraft): Promise<void>;
	remove?(key: string): Promise<void>;
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

export const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
export const MAX_AUDIO_DURATION_SECONDS = 3 * 60 * 60;
