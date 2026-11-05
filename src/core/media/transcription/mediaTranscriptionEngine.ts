import type { OutboundPort } from "../../net/types";
import { TransportError } from "../../net/types";
import { mediaFailure, MediaFailureError } from "../failures";
import { selectedEngine } from "../../ai/configuration";
import type { AiSettings, AsrEngineConfig } from "../../ai/types";
import { transcriptionConfigFingerprint, validateTranscriptionConfig } from "./transcriptionConfig";
import { createTranscriptionProvider } from "./providers";
import type {
	AudioChunk,
	DraftCue,
	TimedWord,
	TranscriptionConfig,
	TranscribeAudio,
} from "../transcriptionTypes";

export interface MediaTranscriptionEngineDeps {
	/** The committed AI engine registry; ASR engines are selected from it. */
	readonly readRegistry: () => AiSettings;
	/** The use-site selection; an empty id means the default ASR engine. */
	readonly resolveEngineId: () => string;
	readonly readSecret: (id: string) => Promise<string | null> | string | null;
	readonly outbound: OutboundPort;
	readonly chunkAudio?: (
		audio: ArrayBuffer,
		signal: AbortSignal,
	) => Promise<{ duration: number; chunks: AudioChunk[] }>;
}

export interface TranscribeMediaInput {
	readonly audio: ArrayBuffer | AudioChunk;
	/** Explicit ASR engine override; omitted uses this engine instance's selection. */
	readonly engineId?: string;
	readonly expectedSignature?: string;
	readonly signal?: AbortSignal;
	readonly onProgress?: (progress: { completedChunks: number; totalChunks: number }) => void;
}

export interface MediaTranscriptionResult {
	readonly cues: readonly DraftCue[];
	readonly words: readonly TimedWord[];
	readonly duration: number;
	readonly signature: string;
}

function isAudioChunk(audio: ArrayBuffer | AudioChunk): audio is AudioChunk {
	return typeof audio === "object" && audio !== null && "wav" in audio && "index" in audio;
}

/**
 * Filters out invalid cues: rejects nulls, non-finite bounds, negative start times,
 * zero/inverted intervals (end <= start), and empty or whitespace-only text.
 */
function sanitizeTranscriptCues(cues: readonly DraftCue[], chunkIndex: number): DraftCue[] {
	let index = 0;
	return cues.flatMap((cue) => {
		const trimmed = cue.text.trim();
		if (
			cue.start !== null &&
			cue.end !== null &&
			Number.isFinite(cue.start) &&
			Number.isFinite(cue.end) &&
			cue.start >= 0 &&
			cue.end > cue.start &&
			trimmed.length > 0
		) {
			const sanitized: DraftCue = {
				id: `chunk-${chunkIndex}-cue-${index++}`,
				start: cue.start,
				end: cue.end,
				text: trimmed,
				needsReview: cue.needsReview ?? false,
			};
			return [sanitized];
		}
		return [];
	});
}

/**
 * Deep core module managing speech recognition execution, secret resolution,
 * configuration drift detection, and cue timestamp hygiene (ADR-0012). Engine
 * identity comes from the shared AI engine registry (ADR-0016); both listening
 * practice and video shadowing execute the same ASR engine kind.
 */
export class MediaTranscriptionEngine {
	private readonly transcribeProvider: TranscribeAudio;

	constructor(private readonly deps: MediaTranscriptionEngineDeps) {
		this.transcribeProvider = createTranscriptionProvider(deps.outbound);
	}

	private async resolveConfig(engineIdOverride?: string): Promise<TranscriptionConfig> {
		const selection = (
			engineIdOverride === undefined ? this.deps.resolveEngineId() : engineIdOverride
		).trim();
		const engine = selectedEngine(this.deps.readRegistry(), "asr", selection);
		if (!engine || engine.kind !== "asr")
			throw mediaFailure({ kind: "config-invalid", field: "engine" });
		return this.configFor(engine);
	}

	private async configFor(engine: AsrEngineConfig): Promise<TranscriptionConfig> {
		if (engine.provider === "bailian") {
			const workspaceId = engine.workspaceSecretId
				? ((await this.deps.readSecret(engine.workspaceSecretId)) ?? "")
				: engine.workspaceId;
			return {
				provider: "bailian",
				workspaceId,
				secretId: engine.secretId,
				model: engine.model,
			};
		}
		return {
			provider: "openai-compatible",
			baseUrl: engine.baseUrl,
			secretId: engine.secretId,
			model: engine.model,
		};
	}

	/** Pure computation of deterministic configuration fingerprint. */
	async getSignature(engineId?: string): Promise<string> {
		const config = await this.resolveConfig(engineId);
		return transcriptionConfigFingerprint(config);
	}

	/** Preflight settings and SecretStorage credentials without media I/O. */
	async preflight(
		options: {
			engineId?: string;
			expectedSignature?: string;
			signal?: AbortSignal;
		} = {},
	): Promise<{ signature: string; config: TranscriptionConfig }> {
		if (options.signal?.aborted) throw mediaFailure({ kind: "cancelled" });

		const config = await this.resolveConfig(options.engineId);
		validateTranscriptionConfig(config);

		const secret = await this.deps.readSecret(config.secretId);
		if (!secret || !secret.trim()) {
			throw mediaFailure({ kind: "config-invalid", field: "secret" });
		}

		const signature = await transcriptionConfigFingerprint(config);
		if (options.signal?.aborted) throw mediaFailure({ kind: "cancelled" });

		if (options.expectedSignature && signature !== options.expectedSignature) {
			throw mediaFailure({ kind: "config-drift" });
		}

		return { signature, config };
	}

	/** Authority transcription execution. */
	async transcribe(input: TranscribeMediaInput): Promise<MediaTranscriptionResult> {
		if (input.signal?.aborted) throw mediaFailure({ kind: "cancelled" });

		const { signature, config } = await this.preflight({
			engineId: input.engineId,
			expectedSignature: input.expectedSignature,
			signal: input.signal,
		});

		try {
			if (isAudioChunk(input.audio)) {
				const transcript = await this.transcribeProvider(
					input.audio,
					config,
					input.signal ?? new AbortController().signal,
				);
				const cues = sanitizeTranscriptCues(transcript.cues, input.audio.index);
				const words = [...transcript.words].sort((a, b) => a.start - b.start);
				const duration =
					input.audio.end > input.audio.start ? input.audio.end - input.audio.start : 0;
				return { cues, words, duration, signature };
			}

			if (this.deps.chunkAudio) {
				const { duration, chunks } = await this.deps.chunkAudio(
					input.audio,
					input.signal ?? new AbortController().signal,
				);
				const allCues: DraftCue[] = [];
				const allWords: TimedWord[] = [];
				for (let i = 0; i < chunks.length; i++) {
					const chunk = chunks[i]!;
					const transcript = await this.transcribeProvider(
						chunk,
						config,
						input.signal ?? new AbortController().signal,
					);
					allCues.push(...sanitizeTranscriptCues(transcript.cues, chunk.index));
					allWords.push(...transcript.words);
					input.onProgress?.({ completedChunks: i + 1, totalChunks: chunks.length });
				}
				allWords.sort((a, b) => a.start - b.start);
				return { cues: allCues, words: allWords, duration, signature };
			}

			// Single chunk fallback for ArrayBuffer
			const singleChunk: AudioChunk = {
				index: 0,
				start: 0,
				end: 0,
				wav: input.audio,
			};
			const transcript = await this.transcribeProvider(
				singleChunk,
				config,
				input.signal ?? new AbortController().signal,
			);
			const cues = sanitizeTranscriptCues(transcript.cues, 0);
			const words = [...transcript.words].sort((a, b) => a.start - b.start);
			const duration = words.length > 0 ? words[words.length - 1]!.end : 0;
			return { cues, words, duration, signature };
		} catch (error) {
			if (error instanceof MediaFailureError) throw error;
			if (
				input.signal?.aborted ||
				(error instanceof TransportError && error.code === "cancelled")
			) {
				throw mediaFailure({ kind: "cancelled" });
			}
			if (error instanceof TransportError) {
				throw mediaFailure({ kind: "provider-failure", code: error.code });
			}
			throw error;
		}
	}
}
