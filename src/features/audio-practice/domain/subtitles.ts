import type { SubtitleCue } from "./types";

function timeValue(value: string): number {
	const parts = value.trim().replace(",", ".").split(":");
	if (parts.length < 2 || parts.length > 3) return NaN;
	const numbers = parts.map(Number);
	if (numbers.some((part) => !Number.isFinite(part) || part < 0)) return NaN;
	if (numbers[numbers.length - 1]! >= 60 || (numbers.length === 3 && numbers[1]! >= 60))
		return NaN;
	return numbers.reduce((total, part) => total * 60 + part, 0);
}

export function parseSubtitles(contents: string): SubtitleCue[] {
	const blocks = contents
		.replace(/^\uFEFF/, "")
		.replace(/\r\n?/g, "\n")
		.split(/\n\s*\n/);
	const cues: SubtitleCue[] = [];
	for (const block of blocks) {
		const lines = block.trim().split("\n");
		if (/^(WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0] ?? "")) continue;
		const timing = lines.findIndex((line) => line.includes("-->"));
		if (timing < 0) continue;
		const match = lines[timing]!.match(/^\s*(\S+)\s*-->\s*(\S+)/);
		if (!match) throw new Error("字幕时间格式无效");
		const start = timeValue(match[1]!);
		const end = timeValue(match[2]!);
		const text = lines
			.slice(timing + 1)
			.join("\n")
			.trim();
		if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text)
			throw new Error("字幕包含无效时间或空白文字");
		const identity = JSON.stringify([text, start, end]);
		let hash = 2166136261;
		for (let i = 0; i < identity.length; i++)
			hash = Math.imul(hash ^ identity.charCodeAt(i), 16777619);
		const baseId = `cue-${(hash >>> 0).toString(36)}`;
		cues.push({
			id: `${baseId}-${cues.filter((cue) => cue.id.startsWith(`${baseId}-`)).length}`,
			start,
			end,
			text,
		});
	}
	if (!cues.length) throw new Error("未找到可用字幕，请选择 SRT 或 VTT 文件");
	return cues.sort((a, b) => a.start - b.start);
}

export function validateCues(cues: readonly SubtitleCue[], duration?: number): string[] {
	const errors: string[] = [];
	const ids = new Set<string>();
	if (!cues.length) errors.push("至少需要一个字幕片段");
	for (const [index, cue] of cues.entries()) {
		if (!cue.id || ids.has(cue.id)) errors.push(`第 ${index + 1} 段标识重复或缺失`);
		ids.add(cue.id);
		if (!cue.text.trim()) errors.push(`第 ${index + 1} 段文字为空`);
		if (/\n[ \t\r]*\n/.test(cue.text))
			errors.push(`第 ${index + 1} 段包含空白行，请删除空白行后保存`);
		if (
			!Number.isFinite(cue.start) ||
			!Number.isFinite(cue.end) ||
			cue.start < 0 ||
			cue.end <= cue.start
		)
			errors.push(`第 ${index + 1} 段时间无效`);
		if (duration !== undefined && Number.isFinite(duration) && cue.end > duration)
			errors.push(`第 ${index + 1} 段超出音频范围`);
		if (cue.needsReview) errors.push(`第 ${index + 1} 段仍需校对`);
	}
	return errors;
}

function formatTime(seconds: number): string {
	const ms = Math.round(seconds * 1000);
	return `${Math.floor(ms / 3600000)
		.toString()
		.padStart(2, "0")}:${Math.floor((ms / 60000) % 60)
		.toString()
		.padStart(2, "0")}:${Math.floor((ms / 1000) % 60)
		.toString()
		.padStart(2, "0")},${(ms % 1000).toString().padStart(3, "0")}`;
}
export function serializeSrt(cues: readonly SubtitleCue[]): string {
	const errors = validateCues(cues);
	if (errors.length) throw new Error(errors.join("；"));
	return [...cues]
		.sort((a, b) => a.start - b.start)
		.map(
			(cue, index) =>
				`${index + 1}\n${formatTime(cue.start)} --> ${formatTime(cue.end)}\n${cue.text.trim()}\n`,
		)
		.join("\n");
}
