type ClassValue =
	| string
	| number
	| boolean
	| undefined
	| null
	| ClassValue[]
	| Record<string, unknown>;

/**
 * Conditionally joins class names together into a single string.
 * Supports strings, numbers, arrays, and truthy object mappings.
 */
export function cls(...args: ClassValue[]): string {
	const classes: string[] = [];

	for (const arg of args) {
		if (!arg) continue;

		if (typeof arg === "string" || typeof arg === "number") {
			classes.push(String(arg));
		} else if (Array.isArray(arg)) {
			const inner = cls(...arg);
			if (inner) {
				classes.push(inner);
			}
		} else if (typeof arg === "object") {
			for (const [key, val] of Object.entries(arg)) {
				if (val) {
					classes.push(key);
				}
			}
		}
	}

	return classes.join(" ");
}
