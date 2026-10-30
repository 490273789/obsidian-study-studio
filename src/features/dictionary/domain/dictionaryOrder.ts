/** Keep saved sources first; append newly available sources in catalog order. */
export function orderSelectionDictionaries<T extends { id: string }>(
	sources: readonly T[],
	order: readonly string[],
): T[] {
	const remaining = new Map(sources.map((source) => [source.id, source]));
	const result: T[] = [];
	for (const id of order) {
		const source = remaining.get(id);
		if (!source) continue;
		result.push(source);
		remaining.delete(id);
	}
	return [...result, ...remaining.values()];
}
