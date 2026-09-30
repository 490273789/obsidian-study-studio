import type { DictionarySandboxStorageMutation, DictionaryTheme } from "./protocol";

declare const sandboxDocumentBrand: unique symbol;

export interface SandboxDocument {
	readonly [sandboxDocumentBrand]: true;
}

interface PreparedSandboxDocument {
	readonly identity: string;
	readonly srcdoc: string;
	readonly updateStorage?: DictionarySandboxStorageUpdater;
}

export type DictionarySandboxStorageUpdater = (
	mutation: DictionarySandboxStorageMutation,
) => Promise<void> | void;

const preparedDocuments = new WeakMap<object, PreparedSandboxDocument>();

export function defineSandboxDocument(
	identity: string,
	srcdoc: string,
	updateStorage?: DictionarySandboxStorageUpdater,
): SandboxDocument {
	const document = Object.freeze({}) as SandboxDocument;
	preparedDocuments.set(document, {
		identity,
		srcdoc,
		...(updateStorage ? { updateStorage } : {}),
	});
	return document;
}

export function sandboxDocumentIdentity(document: SandboxDocument): string {
	return preparedSandboxDocument(document).identity;
}

export function sandboxDocumentSource(
	document: SandboxDocument,
	theme?: DictionaryTheme,
	closeOnEscape = false,
	fitContent = false,
): string {
	const source = preparedSandboxDocument(document).srcdoc;
	if (!theme && !closeOnEscape && !fitContent) return source;
	// Only replace the generated root, never matching text inside dictionary content.
	return source.replace(
		/^<!doctype html><html data-obsidian-tools-dictionary-theme="light">/,
		`<!doctype html><html data-obsidian-tools-dictionary-theme="${theme ?? "light"}"${theme ? ` style="color-scheme:${theme}"` : ""}${closeOnEscape ? ' data-obsidian-tools-dictionary-close-on-escape="true"' : ""}${fitContent ? ' data-obsidian-tools-dictionary-fit-content="true"' : ""}>`,
	);
}

export function sandboxDocumentStorageUpdater(
	document: SandboxDocument,
): DictionarySandboxStorageUpdater | undefined {
	return preparedSandboxDocument(document).updateStorage;
}

function preparedSandboxDocument(document: SandboxDocument): PreparedSandboxDocument {
	const prepared = preparedDocuments.get(document);
	if (!prepared) throw new TypeError("Invalid sandbox document");
	return prepared;
}
