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
export function parseShadowSubtitleImport(
	text: string,
	format: "srt" | "vtt",
): ShadowSubtitleCue[] {
	const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
	const result: ShadowSubtitleCue[] = [];
	for (const block of normalized.split(/\n\s*\n/)) {
		const lines = block.split("\n");
		const index = lines.findIndex((line) => line.includes("-->"));
		if (index < 0) continue;
		const match = lines[index]!.match(
			/((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d+:)?\d{2}:\d{2}[.,]\d{3})/,
		);
		if (!match) throw new Error("字幕时间格式无效。");
		const start = timestamp(match[1]!);
		const end = timestamp(match[2]!);
		const content = lines
			.slice(index + 1)
			.join("\n")
			.trim();
		if (end <= start || !content) throw new Error("字幕范围或内容无效。");
		result.push(makeShadowCue(`import-${result.length}`, { start, end, text: content }));
	}
	if (!result.length) throw new Error(`未找到有效的 ${format.toUpperCase()} 字幕。`);
	return result.sort((a, b) => a.start - b.start);
}
function timestamp(value: string): number {
	const parts = value.replace(",", ".").split(":").map(Number);
	if (
		parts.some((part) => !Number.isFinite(part) || part < 0) ||
		parts[parts.length - 1]! >= 60 ||
		(parts.length === 3 && parts[1]! >= 60)
	)
		throw new Error("字幕时间格式无效。");
	return parts.reduce((sum, part) => sum * 60 + part, 0);
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
