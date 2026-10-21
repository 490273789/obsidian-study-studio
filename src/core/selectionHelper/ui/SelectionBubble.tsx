import React, { useEffect, useRef } from "react";
import { BookOpen, Languages } from "lucide-react";
import { cls } from "../../shared/classNames";
import type { SelectionHelperStrings } from "../strings/selectionPopup";
import styles from "./SelectionPopup.module.scss";

interface SelectionBubbleProps {
	canLookup: boolean;
	canTranslate: boolean;
	strings: SelectionHelperStrings;
	onLookup: () => void;
	onTranslate: () => void;
	onClose: () => void;
}

/** Bare keys belong to the bubble; modified keys remain available to Obsidian commands. */
export function allowsBubbleKey(
	event: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
): boolean {
	return !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
}

export const SelectionBubble = React.memo(function SelectionBubble({
	canLookup,
	canTranslate,
	strings,
	onLookup,
	onTranslate,
	onClose,
}: SelectionBubbleProps) {
	const lookupRef = useRef<HTMLButtonElement | null>(null);
	const translateRef = useRef<HTMLButtonElement | null>(null);

	useEffect(() => {
		if (canLookup) {
			lookupRef.current?.focus();
		} else {
			translateRef.current?.focus();
		}
	}, [canLookup]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				onClose();
				return;
			}
			if (!allowsBubbleKey(event)) return;

			if (event.key === "1") {
				event.preventDefault();
				event.stopPropagation();
				if (canLookup) {
					onLookup();
				} else {
					onTranslate();
				}
				return;
			}

			if (event.key === "2" || event.key === "t" || event.key === "T") {
				event.preventDefault();
				event.stopPropagation();
				if (canTranslate) onTranslate();
				return;
			}

			if (event.key === "Enter") {
				event.preventDefault();
				event.stopPropagation();
				if (canLookup) {
					if (document.activeElement === translateRef.current) {
						onTranslate();
					} else {
						onLookup();
					}
				} else {
					onTranslate();
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown, true);
		return () => {
			window.removeEventListener("keydown", handleKeyDown, true);
		};
	}, [canLookup, canTranslate, onLookup, onTranslate, onClose]);

	return (
		<div
			className={styles.bubble}
			role="toolbar"
			aria-label={strings.settingsHeading}
			tabIndex={-1}
		>
			{canLookup && (
				<button
					ref={lookupRef}
					type="button"
					className={cls(styles.button, styles.buttonPrimary)}
					onClick={(e) => {
						e.stopPropagation();
						onLookup();
					}}
					title={strings.lookup}
				>
					<BookOpen aria-hidden="true" />
					<span>{strings.lookup}</span>
					<span className={styles.hint}>[1]</span>
				</button>
			)}
			{canTranslate && (
				<button
					ref={translateRef}
					type="button"
					className={cls(styles.button, !canLookup && styles.buttonPrimary)}
					onClick={(e) => {
						e.stopPropagation();
						onTranslate();
					}}
					title={strings.translate}
				>
					<Languages aria-hidden="true" />
					<span>{strings.translate}</span>
					<span className={styles.hint}>{canLookup ? "[2]" : "[↵]"}</span>
				</button>
			)}
		</div>
	);
});
