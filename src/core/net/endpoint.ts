export class EndpointValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EndpointValidationError";
	}
}

/**
 * One HTTP(S) endpoint rule for provider connections: absolute http(s), no
 * embedded credentials, query, fragment, or template placeholders. Callers map
 * the failure into their own configuration error.
 */
export function validateHttpEndpoint(
	value: string,
	options: { rejectBraces?: boolean } = {},
): string {
	const rejectBraces = options.rejectBraces ?? true;
	if (rejectBraces && /[{}<>]/.test(value)) {
		throw new EndpointValidationError("Endpoint contains template characters");
	}
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		throw new EndpointValidationError("Endpoint is not a valid URL");
	}
	if (
		!["https:", "http:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	) {
		throw new EndpointValidationError("Endpoint must be a plain http(s) URL");
	}
	return url.toString();
}
