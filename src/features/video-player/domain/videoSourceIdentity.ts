import type { LocalVideoSource } from "./types";

export interface CandidateVideoSource {
	readonly path: string;
	readonly name: string;
	readonly id?: string;
}

/** Device-local path identity survives removing and later re-adding a source. */
export function identifyVideoSources(
	registry: Record<string, string>,
	selected: readonly CandidateVideoSource[],
	current: readonly LocalVideoSource[],
	createId: () => string = () => crypto.randomUUID(),
): LocalVideoSource[] {
	const occupied = new Map(current.map((source) => [source.id, source.path]));
	return selected.map((source) => {
		const savedId = registry[source.path];
		const id =
			savedId && (!occupied.has(savedId) || occupied.get(savedId) === source.path)
				? savedId
				: (source.id ?? createId());
		occupied.set(id, source.path);
		registry[source.path] = id;
		return {
			id,
			path: source.path,
			name: source.name,
		};
	});
}

/** An explicit relink preserves study data while retiring the previous path alias. */
export function relinkVideoSource(
	registry: Record<string, string>,
	sourceId: string,
	replacement: CandidateVideoSource,
): LocalVideoSource {
	for (const [path, id] of Object.entries(registry)) {
		if (id === sourceId) delete registry[path];
	}
	registry[replacement.path] = sourceId;
	return {
		id: sourceId,
		path: replacement.path,
		name: replacement.name,
	};
}
