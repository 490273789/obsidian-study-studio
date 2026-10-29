import { isRecord } from "../../../core/shared/isRecord";
import type { App } from "obsidian";
import {
	VIDEO_PLAYBACK_RATES,
	type DeviceVideoPlayerStateV1,
	type FloatingRect,
	type LocalVideoSource,
	type VideoPlayerDocumentStore,
	type VideoSourceIdentityPort,
} from "../domain/types";
import { emptyState } from "../domain/videoPlayerRuntime";

const LOCAL_VIDEO_PLAYER_STORAGE_KEY = "study-studio.local-video-player.v1";
export const SOURCE_IDS_STORAGE_KEY = "study-studio.shadowing.source-ids.v1";

/** Vault-scoped, device-local storage. Paths never reach plugin data.json. */
export class ObsidianVideoPlayerStateStore implements VideoPlayerDocumentStore {
	constructor(private readonly app: Pick<App, "loadLocalStorage" | "saveLocalStorage">) {}
	load(): DeviceVideoPlayerStateV1 {
		return parseDeviceVideoPlayerState(
			this.app.loadLocalStorage(LOCAL_VIDEO_PLAYER_STORAGE_KEY),
		);
	}
	save(state: DeviceVideoPlayerStateV1): void {
		this.app.saveLocalStorage(LOCAL_VIDEO_PLAYER_STORAGE_KEY, state);
	}
	clear(): void {
		this.app.saveLocalStorage(LOCAL_VIDEO_PLAYER_STORAGE_KEY, null);
	}
}

/** Device-local mapping between canonical video paths and stable source IDs. */
export class ObsidianVideoSourceIdentityStore implements VideoSourceIdentityPort {
	constructor(private readonly app: Pick<App, "loadLocalStorage" | "saveLocalStorage">) {}
	load(): Record<string, string> {
		const saved = this.app.loadLocalStorage(SOURCE_IDS_STORAGE_KEY);
		if (saved && typeof saved === "object" && !Array.isArray(saved)) {
			return Object.fromEntries(
				Object.entries(saved).filter(
					(entry): entry is [string, string] => typeof entry[1] === "string",
				),
			);
		}
		return {};
	}
	save(registry: Record<string, string>): void {
		this.app.saveLocalStorage(SOURCE_IDS_STORAGE_KEY, registry);
	}
	clear(): void {
		this.app.saveLocalStorage(SOURCE_IDS_STORAGE_KEY, null);
	}
}

export function parseDeviceVideoPlayerState(value: unknown): DeviceVideoPlayerStateV1 {
	if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.sources))
		return emptyState();
	const sourceIds = new Set<string>();
	const sourcePaths = new Set<string>();
	const sources = value.sources.flatMap((candidate) => {
		const [source] = parseSource(candidate);
		if (!source || sourceIds.has(source.id) || sourcePaths.has(source.path)) return [];
		sourceIds.add(source.id);
		sourcePaths.add(source.path);
		return [source];
	});
	const ids = new Set(sources.map((source) => source.id));
	const progressBySource: Record<string, number> = {};
	if (isRecord(value.progressBySource)) {
		for (const [id, time] of Object.entries(value.progressBySource))
			if (ids.has(id) && isNonNegativeNumber(time)) progressBySource[id] = time;
	}
	const completedSourceIds = Array.isArray(value.completedSourceIds)
		? value.completedSourceIds.filter(
				(id): id is string => typeof id === "string" && ids.has(id),
			)
		: [];
	return {
		schemaVersion: 1,
		sources,
		currentSourceId:
			typeof value.currentSourceId === "string" && ids.has(value.currentSourceId)
				? value.currentSourceId
				: (sources[0]?.id ?? null),
		progressBySource,
		completedSourceIds: [...new Set(completedSourceIds)],
		playbackRate: VIDEO_PLAYBACK_RATES.includes(
			value.playbackRate as (typeof VIDEO_PLAYBACK_RATES)[number],
		)
			? (value.playbackRate as (typeof VIDEO_PLAYBACK_RATES)[number])
			: 1,
		floatingRect: parseRect(value.floatingRect),
		queueExpanded: value.queueExpanded === true,
	};
}

function parseSource(value: unknown): LocalVideoSource[] {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		typeof value.path !== "string" ||
		typeof value.name !== "string"
	)
		return [];
	return [{ id: value.id, path: value.path, name: value.name }];
}
function parseRect(value: unknown): FloatingRect | null {
	if (
		!isRecord(value) ||
		!isNonNegativeNumber(value.x) ||
		!isNonNegativeNumber(value.y) ||
		!isPositiveNumber(value.width) ||
		!isPositiveNumber(value.height)
	)
		return null;
	return { x: value.x, y: value.y, width: value.width, height: value.height };
}
function isNonNegativeNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function isPositiveNumber(value: unknown): value is number {
	return isNonNegativeNumber(value) && value > 0;
}
