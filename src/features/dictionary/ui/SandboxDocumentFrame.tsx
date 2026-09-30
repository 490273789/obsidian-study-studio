import React, { useEffect, useRef } from "react";
import {
	createDictionarySandboxHost,
	type DictionarySandboxHost,
	type SandboxDocument,
} from "../domain/sandbox-document";
import { cls } from "../../../core/shared/classNames";
import styles from "./Dictionary.module.scss";

export interface SandboxDocumentFrameProps {
	document: SandboxDocument;
	theme: "dark" | "light";
	/** Optional: open a cross-referenced entry. May be omitted. */
	onLookup?: (word: string) => void;
	/** Enables the assistant-only Escape bridge. */
	onClose?: () => void;
	className?: string;
	/** Lets stacked documents share the containing reading area's scrollbar. */
	fitContent?: boolean;
	/** Optional accessible frame name; callers should pass the section title. */
	title?: string;
}

/**
 * Hosts one sandboxed dictionary document.
 *
 * The host seeds the theme into `srcdoc` before the frame navigates, so dark
 * mode never flashes white; later theme changes go through the validated
 * `set-theme` message channel. The host is created inside the registration
 * effect (not `useMemo`) so React StrictMode's mount/unmount/mount cycle gets a
 * live host on the second mount instead of a disposed one.
 */
export const SandboxDocumentFrame = React.memo(function SandboxDocumentFrame({
	document,
	theme,
	onLookup,
	onClose,
	className,
	fitContent = false,
	title,
}: SandboxDocumentFrameProps) {
	const frameRef = useRef<HTMLIFrameElement | null>(null);
	const hostRef = useRef<DictionarySandboxHost | null>(null);
	const themeRef = useRef(theme);
	const onLookupRef = useRef(onLookup);
	const onCloseRef = useRef(onClose);
	const closeOnEscape = Boolean(onClose);

	useEffect(() => {
		onLookupRef.current = onLookup;
	}, [onLookup]);

	useEffect(() => {
		onCloseRef.current = onClose;
	}, [onClose]);

	useEffect(() => {
		themeRef.current = theme;
		hostRef.current?.setTheme(theme);
	}, [theme]);

	useEffect(() => {
		const frame = frameRef.current;
		if (!frame) return;
		const host = createDictionarySandboxHost({
			initialTheme: themeRef.current,
			fitContent,
			openEntry: (term) => onLookupRef.current?.(term),
			...(closeOnEscape ? { onClose: () => onCloseRef.current?.() } : {}),
		});
		hostRef.current = host;
		try {
			host.register(frame, document);
		} catch (error) {
			// A failed effect has no returned cleanup; release its host before the boundary recovers.
			host.dispose();
			if (hostRef.current === host) hostRef.current = null;
			throw error;
		}
		return () => {
			host.unregister(frame);
			host.dispose();
			if (hostRef.current === host) hostRef.current = null;
		};
	}, [document, closeOnEscape, fitContent]);

	return (
		<iframe
			ref={frameRef}
			className={cls("flashcard-dictionary-sandbox", styles.sandbox, className)}
			sandbox="allow-scripts"
			referrerPolicy="no-referrer"
			title={title ?? ""}
		/>
	);
});
