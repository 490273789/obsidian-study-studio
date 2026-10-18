import {
	AUDIO_PLAYBACK_RATES,
	type AudioMaterial,
	type AudioPracticeData,
	type AudioPracticeProgress,
} from "./types";
export function emptyAudioPracticeData(): AudioPracticeData {
	return {
		schemaVersion: 1,
		materials: [],
		currentMaterialId: null,
		progress: {},
		playbackRate: 1,
		mode: "sentence",
		blind: false,
		difficultOnly: false,
	};
}
function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
export function normalizeAudioPracticeData(raw: unknown): AudioPracticeData {
	const empty = emptyAudioPracticeData();
	if (!record(raw) || raw.schemaVersion !== 1) return empty;
	const seen = new Set<string>();
	const materials: AudioMaterial[] = [];
	if (Array.isArray(raw.materials))
		for (const value of raw.materials) {
			if (
				!record(value) ||
				typeof value.id !== "string" ||
				!value.id ||
				seen.has(value.id) ||
				typeof value.audioPath !== "string" ||
				!value.audioPath ||
				typeof value.title !== "string"
			)
				continue;
			seen.add(value.id);
			materials.push({
				id: value.id,
				title: value.title,
				audioPath: value.audioPath,
				subtitlePath: typeof value.subtitlePath === "string" ? value.subtitlePath : null,
				originalText: typeof value.originalText === "string" ? value.originalText : "",
			});
		}
	const progress: Record<string, AudioPracticeProgress> = {};
	for (const material of materials) {
		const value = record(raw.progress) ? raw.progress[material.id] : undefined;
		progress[material.id] = record(value)
			? {
					time:
						typeof value.time === "number" && Number.isFinite(value.time)
							? Math.max(0, value.time)
							: 0,
					cueId: typeof value.cueId === "string" ? value.cueId : null,
					difficultCueIds: Array.isArray(value.difficultCueIds)
						? [
								...new Set(
									value.difficultCueIds.filter(
										(id): id is string => typeof id === "string",
									),
								),
							]
						: [],
					offset:
						typeof value.offset === "number" && Number.isFinite(value.offset)
							? value.offset
							: 0,
				}
			: emptyProgress();
	}
	return {
		...empty,
		materials,
		progress,
		currentMaterialId:
			typeof raw.currentMaterialId === "string" && seen.has(raw.currentMaterialId)
				? raw.currentMaterialId
				: (materials[0]?.id ?? null),
		playbackRate: AUDIO_PLAYBACK_RATES.includes(raw.playbackRate as never)
			? (raw.playbackRate as AudioPracticeData["playbackRate"])
			: 1,
		mode: raw.mode === "continuous" && raw.difficultOnly !== true ? "continuous" : "sentence",
		blind: raw.blind === true,
		difficultOnly: raw.difficultOnly === true,
	};
}
export function emptyProgress(): AudioPracticeProgress {
	return { time: 0, cueId: null, difficultCueIds: [], offset: 0 };
}
