export const DICTIONARY_SANDBOX_CHANNEL = "obsidian-tools.dictionary-sandbox";
export const DICTIONARY_SANDBOX_PROTOCOL_VERSION = 1;
export const DICTIONARY_SANDBOX_MAX_CONTENT_HEIGHT = 8192;

export type DictionaryTheme = "dark" | "light";

export type DictionarySandboxAction =
	| "content-height"
	| "open-entry"
	| "play-audio"
	| "set-theme"
	| "storage-update"
	| "request-close";

export type DictionarySandboxStorageMutation =
	| { readonly key: string; readonly operation: "remove" }
	| { readonly key: string; readonly operation: "set"; readonly value: string }
	| { readonly operation: "clear" };

export interface DictionarySandboxEnvelope {
	readonly action: DictionarySandboxAction;
	readonly channel: typeof DICTIONARY_SANDBOX_CHANNEL;
	readonly documentId: string;
	readonly payload: unknown;
	readonly version: typeof DICTIONARY_SANDBOX_PROTOCOL_VERSION;
}

export function createSandboxDocumentIdentity(): string {
	const bytes = new Uint8Array(16);
	globalThis.crypto.getRandomValues(bytes);
	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function sandboxMessageExpression(
	documentId: string,
	action: DictionarySandboxAction,
	payload: string,
): string {
	return `parent.postMessage({channel:'${DICTIONARY_SANDBOX_CHANNEL}',version:${DICTIONARY_SANDBOX_PROTOCOL_VERSION},documentId:'${documentId}',action:'${action}',payload:${payload}},'*')`;
}

export function createSandboxEnvelope(
	documentId: string,
	action: DictionarySandboxAction,
	payload: unknown,
): DictionarySandboxEnvelope {
	return {
		action,
		channel: DICTIONARY_SANDBOX_CHANNEL,
		documentId,
		payload,
		version: DICTIONARY_SANDBOX_PROTOCOL_VERSION,
	};
}

export function parseSandboxEnvelope(value: unknown): DictionarySandboxEnvelope | null {
	if (!value || typeof value !== "object") return null;
	const envelope = value as Partial<Record<keyof DictionarySandboxEnvelope, unknown>>;
	if (
		envelope.channel !== DICTIONARY_SANDBOX_CHANNEL ||
		envelope.version !== DICTIONARY_SANDBOX_PROTOCOL_VERSION ||
		typeof envelope.documentId !== "string" ||
		(envelope.action !== "open-entry" &&
			envelope.action !== "content-height" &&
			envelope.action !== "request-close" &&
			envelope.action !== "play-audio" &&
			envelope.action !== "set-theme" &&
			envelope.action !== "storage-update")
	) {
		return null;
	}
	return envelope as DictionarySandboxEnvelope;
}

export function parseSandboxStorageMutation(
	value: unknown,
): DictionarySandboxStorageMutation | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const mutation = value as Record<string, unknown>;
	if (mutation.operation === "clear") return { operation: "clear" };
	if (
		(mutation.operation !== "remove" && mutation.operation !== "set") ||
		typeof mutation.key !== "string" ||
		!mutation.key ||
		mutation.key.length > 128 ||
		mutation.key.includes("\0")
	) {
		return null;
	}
	if (mutation.operation === "remove") {
		return { key: mutation.key, operation: "remove" };
	}
	return typeof mutation.value === "string" &&
		mutation.value.length <= 16_384 &&
		!mutation.value.includes("\0")
		? { key: mutation.key, operation: "set", value: mutation.value }
		: null;
}
