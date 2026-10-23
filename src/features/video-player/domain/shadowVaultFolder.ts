/** Only normalized vault-relative directories may contain study artifacts. */
export function validShadowVaultFolder(value: unknown): value is string {
	if (typeof value !== "string" || !value.trim() || value !== value.trim()) return false;
	if (value.includes("\\") || value.includes(":") || value.startsWith("/")) return false;
	for (let index = 0; index < value.length; index++)
		if (value.charCodeAt(index) < 32) return false;
	return value.split("/").every((part) => !!part && part !== "." && part !== "..");
}
