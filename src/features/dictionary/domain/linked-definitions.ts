import { normalizeCompiledLookupKey } from "./compiled-package/internal";

export interface RecordValue {
	readonly definition: string;
	readonly keyText: string;
}

const MAX_LINK_DEPTH = 8;
const MAX_LOOKUP_KEYS = 64;
const MAX_DEFINITIONS = 64;

export async function resolveLinkedDefinitions(
	initialKey: string,
	exactDefinitions: (key: string) => Promise<readonly RecordValue[]>,
): Promise<RecordValue[]> {
	const queue = [{ key: initialKey, depth: 0 }];
	const scheduled = new Set([initialKey]);
	const definitions: RecordValue[] = [];
	const seenDefinitions = new Map<string, Set<string>>();
	// Breadth-first traversal gives shared targets their shortest available link path.
	for (let index = 0; index < queue.length; index += 1) {
		const { key, depth } = queue[index]!;
		// oxlint-disable-next-line no-await-in-loop -- ordered, bounded reads preserve result order and stop at the result limit.
		const values = await exactDefinitions(key);
		for (const value of values.slice(0, MAX_DEFINITIONS)) {
			const link = /^\s*@@@LINK=(.*?)\s*$/i.exec(value.definition);
			if (link) {
				const target = normalizeCompiledLookupKey(link[1]!);
				if (
					target &&
					target.length <= 512 &&
					depth < MAX_LINK_DEPTH &&
					!scheduled.has(target) &&
					scheduled.size < MAX_LOOKUP_KEYS
				) {
					scheduled.add(target);
					queue.push({ key: target, depth: depth + 1 });
				}
				continue;
			}
			const seen = seenDefinitions.get(value.keyText) ?? new Set<string>();
			if (seen.has(value.definition)) continue;
			seen.add(value.definition);
			seenDefinitions.set(value.keyText, seen);
			definitions.push(value);
			if (definitions.length >= MAX_DEFINITIONS) return definitions;
		}
	}
	return definitions;
}
