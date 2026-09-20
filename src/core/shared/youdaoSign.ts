/**
 * Feature-independent Youdao openapi v3 signing and form building, shared by the
 * The truncation rule counts code points, matching Youdao's documented
 * "characters" semantics, so surrogate-pair text (emoji, rare CJK) signs
 * identically across callers.
 */

export function youdaoV3SignInput(query: string): string {
	// Youdao's documented "characters" are code points, so iterating the string is
	// intentional here even though it splits grapheme clusters.
	// oxlint-disable-next-line typescript/no-misused-spread -- code points are the documented unit
	const characters = [...query];
	return characters.length <= 20
		? query
		: `${characters.slice(0, 10).join("")}${characters.length}${characters.slice(-10).join("")}`;
}

async function sha256(value: string): Promise<string> {
	const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface YoudaoV3BodyOptions {
	appKey: string;
	appSecret: string;
	curtime?: string;
	fields?: Readonly<Record<string, string>>;
	query: string;
	salt?: string;
}

export async function buildYoudaoV3Body(options: YoudaoV3BodyOptions): Promise<string> {
	const salt =
		options.salt ??
		crypto.randomUUID?.() ??
		`${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const curtime = options.curtime ?? Math.floor(Date.now() / 1000).toString();
	const sign = await sha256(
		`${options.appKey}${youdaoV3SignInput(options.query)}${salt}${curtime}${options.appSecret}`,
	);
	const parameters = new URLSearchParams({
		appKey: options.appKey,
		curtime,
		q: options.query,
		salt,
		sign,
		signType: "v3",
		...options.fields,
	});
	return parameters.toString();
}
