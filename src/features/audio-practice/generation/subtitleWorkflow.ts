import type { AudioPracticeRuntime } from "../domain/audioPracticeRuntime";
import { type AudioPracticeFailure, type AudioFailure, toAudioFailure } from "../domain/failures";
import type { AudioMaterial, AudioPracticeSnapshot, SubtitleCue } from "../domain/types";
import type { AudioPracticeSettings } from "../settings/slice";
import { MAX_AUDIO_BYTES } from "./limits";
import type { GenerationInput, SubtitleGeneration } from "./subtitleGeneration";
import { validateTranscriptionConfig } from "./transcriptionConfig";
import type { AudioSourceFiles, TranscriptionConfig } from "./types";

/**
 * Subtitle workflow - the feature-owned transaction around subtitle generation.
 *
 * It owns admission (settings, secret, source identity, size), draft ownership
 * on material switches, and the ordering fence that adopts a reviewed draft
 * into the vault. Generation and playback stay in their own deep modules; this
 * module only publishes the transient operation state and semantic intents.
 */

export type SubtitleWorkflowActivity = "idle" | "generating" | "saving";

/** Typed failure vocabulary; copy lives in `strings/failures.ts`. */
export type SubtitleWorkflowFailure = AudioPracticeFailure;

export interface SubtitleWorkflowSnapshot {
	readonly activity: SubtitleWorkflowActivity;
	readonly failure: SubtitleWorkflowFailure | null;
}

export type SubtitleWorkflowOutcome =
	| { readonly kind: "applied" }
	| { readonly kind: "rejected"; readonly failure: SubtitleWorkflowFailure }
	| { readonly kind: "failed"; readonly failure: SubtitleWorkflowFailure };

export interface SubtitleWorkflowPorts {
	runtime: Pick<AudioPracticeRuntime, "getSnapshot" | "subscribe" | "saveSubtitles">;
	generation: Pick<
		SubtitleGeneration,
		| "getSnapshot"
		| "subscribe"
		| "generate"
		| "cancel"
		| "restore"
		| "matchesSource"
		| "validatedCues"
	>;
	settings: {
		read(): AudioPracticeSettings;
		readSecret(id: string): string | null;
	};
	source: AudioSourceFiles;
}

const ACTIVE_GENERATION_STATUSES = new Set(["preparing", "transcribing", "aligning"]);

class SubtitleWorkflowFailureError extends Error {
	constructor(readonly failure: SubtitleWorkflowFailure) {
		super(failure.kind);
		this.name = "SubtitleWorkflowFailureError";
	}
}

function fileName(path: string): string {
	return path.split("/").pop() ?? path;
}

function failureFrom(error: unknown): AudioPracticeFailure {
	if (error instanceof SubtitleWorkflowFailureError) return error.failure;
	return toAudioFailure(error);
}

export class SubtitleWorkflow {
	private readonly listeners = new Set<() => void>();
	private readonly releases: (() => void)[] = [];
	private snapshot: SubtitleWorkflowSnapshot = Object.freeze({
		activity: "idle",
		failure: null,
	});
	private epoch = 0;
	private disposed = false;

	constructor(private readonly ports: SubtitleWorkflowPorts) {
		this.releases.push(ports.runtime.subscribe(() => this.reconcileRestore()));
		this.releases.push(ports.generation.subscribe(() => this.reconcileRestore()));
		this.reconcileRestore();
	}

	getSnapshot = (): SubtitleWorkflowSnapshot => this.snapshot;

	subscribe = (listener: () => void): (() => void) => {
		if (this.disposed) return () => {};
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	/** Admits and starts subtitle generation for the given material. */
	generate(materialId: string, force = false): Promise<SubtitleWorkflowOutcome> {
		return this.run("generating", (epoch) => this.admitGeneration(materialId, force, epoch));
	}

	/** Validates a reviewed draft and adopts it as the material's subtitles. */
	saveDraft(materialId: string): Promise<SubtitleWorkflowOutcome> {
		return this.run("saving", (epoch) => this.admitSave(materialId, epoch));
	}

	/** Cancels the current operation; a pending vault read will not start a request. */
	cancel(): void {
		if (this.disposed) return;
		this.epoch++;
		this.ports.generation.cancel();
	}

	/** Acknowledges a displayed failure, so the view can clear its alert. */
	dismissFailure(): void {
		if (this.snapshot.failure === null) return;
		this.publish({ activity: this.snapshot.activity, failure: null });
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.epoch++;
		this.ports.generation.cancel();
		for (const release of this.releases.splice(0)) release();
		this.listeners.clear();
	}

	private run(
		activity: SubtitleWorkflowActivity,
		body: (epoch: number) => Promise<void>,
	): Promise<SubtitleWorkflowOutcome> {
		if (this.disposed) {
			return Promise.resolve({
				kind: "rejected",
				failure: { kind: "cancelled" },
			});
		}
		if (this.snapshot.activity !== "idle") {
			return Promise.resolve({
				kind: "rejected",
				failure: { kind: "busy" },
			});
		}
		const epoch = this.epoch;
		this.publish({ activity, failure: null });
		return body(epoch).then(
			() => {
				const cancelled = this.disposed || epoch !== this.epoch;
				this.publish({ activity: "idle", failure: null });
				return cancelled
					? ({ kind: "rejected", failure: { kind: "cancelled" } } as const)
					: ({ kind: "applied" } as const);
			},
			(error: unknown) => {
				const failure = failureFrom(error);
				this.publish({ activity: "idle", failure });
				return failure.kind === "cancelled" || failure.kind === "busy"
					? ({ kind: "rejected", failure } as const)
					: ({ kind: "failed", failure } as const);
			},
		);
	}

	private publish(next: SubtitleWorkflowSnapshot): void {
		if (this.disposed) return;
		this.snapshot = Object.freeze(next);
		for (const listener of this.listeners) listener();
	}

	private ensureActive(epoch: number): void {
		if (this.disposed || epoch !== this.epoch)
			throw new SubtitleWorkflowFailureError({ kind: "cancelled" });
	}

	private material(materialId: string): AudioMaterial | null {
		const snapshot: AudioPracticeSnapshot = this.ports.runtime.getSnapshot();
		return snapshot.materials.find((item) => item.id === materialId) ?? null;
	}

	private requireMaterial(materialId: string): AudioMaterial {
		const material = this.material(materialId);
		if (!material) throw new SubtitleWorkflowFailureError({ kind: "missing-file" });
		return material;
	}

	private async readSource(path: string): Promise<ArrayBuffer> {
		try {
			return await this.ports.source.readBinary(path);
		} catch (error) {
			throw new SubtitleWorkflowFailureError(toAudioFailure(error));
		}
	}

	private async admitGeneration(
		materialId: string,
		force: boolean,
		epoch: number,
	): Promise<void> {
		this.ensureActive(epoch);
		const settings = this.ports.settings.read();
		const config = transcriptionConfig(settings);
		try {
			validateTranscriptionConfig(config);
		} catch (error) {
			throw new SubtitleWorkflowFailureError(toAudioFailure(error));
		}
		const secret = this.ports.settings.readSecret(config.secretId);
		if (!secret)
			throw new SubtitleWorkflowFailureError({ kind: "config-invalid", field: "secret" });
		const material = this.requireMaterial(materialId);
		const stat = this.ports.source.stat(material.audioPath);
		if (!stat) throw new SubtitleWorkflowFailureError({ kind: "missing-file" });
		if (stat.size > MAX_AUDIO_BYTES)
			throw new SubtitleWorkflowFailureError({
				kind: "audio-too-large",
				maxBytes: MAX_AUDIO_BYTES,
			});
		const audio = await this.readSource(material.audioPath);
		this.ensureActive(epoch);
		const current = this.requireMaterial(materialId);
		const input: GenerationInput = {
			audio,
			name: fileName(current.audioPath),
			taskKey: materialId,
			referenceText: current.originalText,
			config,
		};
		await this.ports.generation.generate(input, { force });
	}

	private async admitSave(materialId: string, epoch: number): Promise<void> {
		this.ensureActive(epoch);
		if (this.ports.generation.getSnapshot().taskKey !== materialId)
			throw new SubtitleWorkflowFailureError({ kind: "stale-material" });
		const material = this.requireMaterial(materialId);
		const stat = this.ports.source.stat(material.audioPath);
		if (!stat) throw new SubtitleWorkflowFailureError({ kind: "missing-file" });
		const mtime = stat.mtime;
		const audio = await this.readSource(material.audioPath);
		this.ensureActive(epoch);
		const matches = await this.ports.generation.matchesSource(audio, material.originalText);
		this.ensureActive(epoch);
		const current = this.material(materialId);
		const afterStat = current ? this.ports.source.stat(current.audioPath) : null;
		if (
			!matches ||
			this.ports.generation.getSnapshot().taskKey !== materialId ||
			current?.audioPath !== material.audioPath ||
			current?.originalText !== material.originalText ||
			afterStat?.mtime !== mtime
		)
			throw new SubtitleWorkflowFailureError({ kind: "source-changed" });
		let cues: SubtitleCue[];
		try {
			cues = this.ports.generation.validatedCues();
		} catch (error) {
			throw new SubtitleWorkflowFailureError(toAudioFailure(error));
		}
		try {
			await this.ports.runtime.saveSubtitles(materialId, cues);
		} catch (error) {
			throw new SubtitleWorkflowFailureError(
				error instanceof Error && "failure" in error
					? (error as { failure: AudioFailure }).failure
					: { kind: "subtitle-write-failed" },
			);
		}
	}

	/**
	 * Mirrors the card presentation rule: only restore when no generation is in
	 * flight, the workflow is idle, and the loaded draft belongs to another material.
	 */
	private reconcileRestore(): void {
		if (this.disposed || this.snapshot.activity !== "idle") return;
		const generation = this.ports.generation.getSnapshot();
		if (ACTIVE_GENERATION_STATUSES.has(generation.status)) return;
		const currentMaterialId = this.ports.runtime.getSnapshot().currentMaterialId;
		if (!currentMaterialId || generation.taskKey === currentMaterialId) return;
		void this.ports.generation.restore(currentMaterialId).catch(() => {});
	}
}

function transcriptionConfig(settings: AudioPracticeSettings): TranscriptionConfig {
	return settings.provider === "bailian"
		? {
				provider: "bailian",
				workspaceId: settings.bailianWorkspaceId.trim(),
				secretId: settings.bailianSecretId,
				model: settings.bailianModel.trim(),
			}
		: {
				provider: "openai-compatible",
				baseUrl: settings.openaiBaseUrl.trim(),
				secretId: settings.openaiSecretId,
				model: settings.openaiModel.trim(),
			};
}
