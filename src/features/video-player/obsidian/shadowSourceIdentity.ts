import type { LocalVideoSource } from "../domain/types";

/** Device-local path identity survives removing and later re-adding a source. */
export function identifyShadowSources(
	registry: Record<string, string>,
	selected: readonly LocalVideoSource[],
	current: readonly LocalVideoSource[],
): LocalVideoSource[] {
	const occupied = new Map(current.map((source) => [source.id, source.path]));
	return selected.map((source) => {
		const savedId = registry[source.path];
		const id =
			savedId && (!occupied.has(savedId) || occupied.get(savedId) === source.path)
				? savedId
				: source.id;
		occupied.set(id, source.path);
		registry[source.path] = id;
		return { ...source, id };
	});
}

/** An explicit relink preserves study data while retiring the previous path alias. */
export function relinkShadowSource(
	registry: Record<string, string>,
	sourceId: string,
	replacement: LocalVideoSource,
): LocalVideoSource {
	for (const [path, id] of Object.entries(registry)) if (id === sourceId) delete registry[path];
	registry[replacement.path] = sourceId;
	return { ...replacement, id: sourceId };
}
