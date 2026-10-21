/** Narrows an unknown filesystem failure to a specific Node error code. */
export function hasErrorCode(error: unknown, code: string): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === code
	);
}

/** Probes a path with `lstat`; only ENOENT counts as absence, other failures go through `mapError`. */
export async function pathExists(
	lstat: (path: string) => Promise<unknown>,
	path: string,
	mapError: (error: unknown) => Error,
): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) return false;
		throw mapError(error);
	}
}
