import { TransportError, type OutboundPort } from "../../../../core/net/types";
import type { PronunciationSettings } from "../../../../core/shared/types";
import { AZURE_CHINA_REGIONS } from "./pronunciationSettings";
import type { PronunciationRequestDescriptor, SynthesizedAudio } from "./types";

export type PronunciationRequester = OutboundPort["request"];

interface PronunciationRequestOptions {
	signal?: AbortSignal;
	timeoutMs?: number;
}

export class PronunciationProviderError extends Error {
	constructor(
		message: string,
		readonly status: number | null,
	) {
		super(message);
		this.name = "PronunciationProviderError";
	}
}

const AZURE_VOICES = {
	"en-US": "en-US-JennyNeural",
	"en-GB": "en-GB-SoniaNeural",
} as const;
const OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
const OPENAI_TTS_VOICE = "marin";

export function createPronunciationRequestDescriptor(
	text: string,
	settings: PronunciationSettings,
	systemLanguage = "en-US",
): PronunciationRequestDescriptor | null {
	const provider = settings.onlineProvider;
	if (provider === "none") return null;
	const accent =
		settings.accent === "en-GB" ||
		(settings.accent === "system" && systemLanguage.toLowerCase().startsWith("en-gb"))
			? "en-GB"
			: "en-US";
	const variant =
		provider === "azure"
			? [settings.azureCloud, settings.azureRegion, AZURE_VOICES[accent], settings.rate].join(
					":",
				)
			: [OPENAI_TTS_MODEL, OPENAI_TTS_VOICE, accent, settings.rate].join(":");
	return {
		provider,
		text: normalizePronunciationText(text),
		accent,
		rate: settings.rate,
		variant,
	};
}

export async function synthesizeAzureSpeech(
	net: Pick<OutboundPort, "request">,
	descriptor: PronunciationRequestDescriptor,
	settings: PronunciationSettings,
	secret: string,
	options: PronunciationRequestOptions = {},
): Promise<SynthesizedAudio> {
	const region = settings.azureRegion.trim().toLowerCase();
	if (!/^[a-z0-9]+$/.test(region)) {
		throw new PronunciationProviderError("Invalid Azure Speech region", null);
	}
	if (settings.azureCloud === "china" && !AZURE_CHINA_REGIONS.has(region)) {
		throw new PronunciationProviderError("Unsupported Azure China Speech region", null);
	}
	const domain =
		settings.azureCloud === "china" ? "tts.speech.azure.cn" : "tts.speech.microsoft.com";
	const voice = AZURE_VOICES[descriptor.accent];
	const prosodyRate = descriptor.rate === "slow" ? "-25%" : "0%";
	const body = [
		`<speak version="1.0" xml:lang="${descriptor.accent}">`,
		`<voice name="${voice}">`,
		`<prosody rate="${prosodyRate}">${escapeXml(descriptor.text)}</prosody>`,
		"</voice>",
		"</speak>",
	].join("");
	const response = await net.request({
		label: "pronunciation-azure",
		url: `https://${region}.${domain}/cognitiveservices/v1`,
		method: "POST",
		headers: {
			"Content-Type": "application/ssml+xml",
			"Ocp-Apim-Subscription-Key": secret,
			"X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
			"User-Agent": "wsr-flash-card",
		},
		body,
		...options,
	});
	if (!response.arrayBuffer) throw new TransportError("invalid-response");
	return {
		data: response.arrayBuffer,
		mimeType: getContentType(response.headers) ?? "audio/mpeg",
		source: "azure",
	};
}

export async function synthesizeOpenAiSpeech(
	net: Pick<OutboundPort, "request">,
	descriptor: PronunciationRequestDescriptor,
	secret: string,
	options: PronunciationRequestOptions = {},
): Promise<SynthesizedAudio> {
	const accentDescription =
		descriptor.accent === "en-GB" ? "standard British English" : "standard American English";
	const response = await net.request({
		label: "pronunciation-openai",
		url: "https://api.openai.com/v1/audio/speech",
		method: "POST",
		headers: {
			Authorization: `Bearer ${secret}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: OPENAI_TTS_MODEL,
			voice: OPENAI_TTS_VOICE,
			input: descriptor.text,
			instructions: `Pronounce only the supplied English word or phrase in a clear ${accentDescription} accent. Do not add any other words or sounds.`,
			response_format: "mp3",
			speed: descriptor.rate === "slow" ? 0.75 : 1,
		}),
		...options,
	});
	if (!response.arrayBuffer) throw new TransportError("invalid-response");
	return {
		data: response.arrayBuffer,
		mimeType: getContentType(response.headers) ?? "audio/mpeg",
		source: "openai",
	};
}

export function normalizePronunciationText(text: string): string {
	return text.normalize("NFC").trim().replace(/\s+/gu, " ");
}

function escapeXml(value: string): string {
	return value.replace(/[<>&'"]/g, (character) => {
		switch (character) {
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case "&":
				return "&amp;";
			case "'":
				return "&apos;";
			default:
				return "&quot;";
		}
	});
}

function getContentType(headers: Record<string, string> | undefined): string | null {
	if (!headers) return null;
	for (const [name, value] of Object.entries(headers)) {
		if (name.toLowerCase() === "content-type") return value.split(";")[0]?.trim() ?? null;
	}
	return null;
}
