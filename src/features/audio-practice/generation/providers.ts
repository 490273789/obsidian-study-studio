import type { OutboundPort } from "../../../core/net/types";
import { createBailianProvider } from "./bailianProvider";
import { createOpenAiCompatibleProvider } from "./openAiCompatibleProvider";
import type { TranscribeAudio } from "./types";

/** Dispatches one chunk transcription to the provider family selected in settings. */
export function createTranscriptionProvider(outbound: OutboundPort): TranscribeAudio {
	const bailian = createBailianProvider(outbound);
	const openAiCompatible = createOpenAiCompatibleProvider(outbound);
	return (chunk, config, signal) =>
		config.provider === "bailian"
			? bailian(chunk, config, signal)
			: openAiCompatible(chunk, config, signal);
}
