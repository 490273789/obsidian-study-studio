import { TransportError } from "../../../core/net/types";
import { mediaFailure } from "../../../core/media/failures";
import {
	transcriptionConfigFingerprint,
	validateTranscriptionConfig,
} from "../../../core/media/transcription/transcriptionConfig";
import type {
	TranscriptionConfig,
	TranscriptionProviderId,
} from "../../../core/media/transcriptionTypes";
import type { AudioPracticeSettings } from "../settings/slice";

export interface TranscriptionSettingsReader {
	read(): AudioPracticeSettings;
	readSecret(id: string): string | null;
}

export class TranscriptionConfigurationChangedError extends Error {
	constructor() {
		super("Transcription configuration changed");
		this.name = "TranscriptionConfigurationChangedError";
	}
}

/** Owns settings interpretation, preflight, and task admission without owning a draft or video task. */
export class TranscriptionConfiguration {
	constructor(private readonly settings: TranscriptionSettingsReader) {}

	/** A request-free identity remains available when only imported subtitles need translation. */
	signature(provider?: TranscriptionProviderId): Promise<string> {
		return transcriptionConfigFingerprint(this.read(provider));
	}

	/** Reject incomplete settings before the caller reads or prepares any audio. */
	prepare(provider?: TranscriptionProviderId): TranscriptionConfig {
		const config = this.read(provider);
		validateTranscriptionConfig(config);
		if (!this.readSecret(config.secretId))
			throw mediaFailure({ kind: "config-invalid", field: "secret" });
		return Object.freeze(config);
	}

	/** Return the exact configuration matched to an accepted task, including across async hashing. */
	async accept(
		provider: TranscriptionProviderId,
		expectedSignature: string,
		signal: AbortSignal,
	): Promise<TranscriptionConfig> {
		if (signal.aborted) throw new TransportError("cancelled");
		const config = this.prepare(provider);
		const signature = await transcriptionConfigFingerprint(config);
		if (signal.aborted) throw new TransportError("cancelled");
		if (
			signature !== expectedSignature ||
			JSON.stringify(config) !== JSON.stringify(this.read(provider))
		)
			throw new TranscriptionConfigurationChangedError();
		return config;
	}

	private read(provider?: TranscriptionProviderId): TranscriptionConfig {
		const settings = this.settings.read();
		if ((provider ?? settings.provider) === "openai-compatible") {
			return {
				provider: "openai-compatible",
				baseUrl: settings.openaiBaseUrl.trim(),
				secretId: settings.openaiSecretId.trim(),
				model: settings.openaiModel.trim(),
			};
		}
		const workspaceReference = settings.bailianWorkspaceSecretId.trim();
		return {
			provider: "bailian",
			workspaceId: workspaceReference
				? (this.readSecret(workspaceReference)?.trim() ?? "")
				: settings.bailianWorkspaceId.trim(),
			secretId: settings.bailianSecretId.trim(),
			model: settings.bailianModel.trim(),
		};
	}

	private readSecret(id: string): string | null {
		try {
			return this.settings.readSecret(id);
		} catch {
			return null;
		}
	}
}
