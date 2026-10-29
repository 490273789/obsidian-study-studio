import { parseSubtitles } from "../../../core/media/subtitles";

export interface ShadowSubtitleCue {
	id: string;
	start: number;
	end: number;
	text: string;
	translation: string;
	revision: number;
	textEdited: boolean;
	translationEdited: boolean;
}
export interface ShadowSubtitleDocument {
	sourceId: string;
	revision: number;
	cues: ShadowSubtitleCue[];
	previous: ShadowSubtitleCue[] | null;
	candidate: ShadowSubtitleCue[] | null;
}
export interface ShadowTranscriptionCue {
	start: number;
	end: number;
	text: string;
}
/** Parses external SRT or VTT subtitles using the core unified subtitle parser. */
export function parseShadowSubtitleImport(
	text: string,
	_format?: "srt" | "vtt",
): ShadowSubtitleCue[] {
	const parsed = parseSubtitles(text);
	return parsed.map((cue, index) =>
		makeShadowCue(`import-${index}`, {
			start: cue.start,
			end: cue.end,
			text: cue.text,
		}),
	);
}

export function makeShadowCue(id: string, cue: ShadowTranscriptionCue): ShadowSubtitleCue {
	return {
		...cue,
		id,
		translation: "",
		revision: 1,
		textEdited: false,
		translationEdited: false,
	};
}
export function emptyShadowDocument(sourceId: string): ShadowSubtitleDocument {
	return { sourceId, revision: 0, cues: [], previous: null, candidate: null };
}
