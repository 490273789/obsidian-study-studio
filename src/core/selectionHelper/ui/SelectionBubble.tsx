import React, { useEffect, useMemo, useRef } from "react";
import { BookOpen, Languages } from "lucide-react";
import { cls } from "../../shared/classNames";
import type { SelectionHelperStrings } from "../strings/selectionPopup";
import styles from "./SelectionPopup.module.scss";

export interface SelectionBubbleActionItem {
	readonly id: string;
	readonly label: string;
	readonly icon?: React.ReactNode;
	readonly hint?: string;
	readonly isPrimary?: boolean;
	readonly keyEquivalents?: readonly string[];
	onTrigger: () => void;
}

export interface SelectionBubbleProps {
	actions?: readonly SelectionBubbleActionItem[];
	canLookup?: boolean;
	canTranslate?: boolean;
	strings: SelectionHelperStrings;
	onLookup?: () => void;
	onTranslate?: () => void;
	onClose: () => void;
}

/** Bare keys belong to the bubble; modified keys remain available to Obsidian commands. */
export function allowsBubbleKey(
	event: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
): boolean {
	return !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
}

export const SelectionBubble = React.memo(function SelectionBubble(props: SelectionBubbleProps) {
	const {
		actions: customActions,
		canLookup = false,
		canTranslate = false,
		strings,
		onLookup,
		onTranslate,
		onClose,
	} = props;

	const actions = useMemo<readonly SelectionBubbleActionItem[]>(() => {
		if (customActions && customActions.length > 0) return customActions;
		const items: SelectionBubbleActionItem[] = [];
		if (canLookup && onLookup) {
			items.push({
				id: "lookup",
				label: strings.lookup,
				icon: <BookOpen aria-hidden="true" />,
				hint: "[1]",
				isPrimary: true,
				keyEquivalents: ["1"],
				onTrigger: onLookup,
			});
		}
		if (canTranslate && onTranslate) {
			items.push({
				id: "translate",
				label: strings.translate,
				icon: <Languages aria-hidden="true" />,
				hint: items.length > 0 ? "[2]" : "[↵]",
				isPrimary: items.length === 0,
				keyEquivalents: ["2", "t", "T"],
				onTrigger: onTranslate,
			});
		}
		return items;
	}, [customActions, canLookup, canTranslate, strings, onLookup, onTranslate]);

	const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

	useEffect(() => {
		const primaryIndex = actions.findIndex((a) => a.isPrimary);
		const targetIndex = primaryIndex >= 0 ? primaryIndex : 0;
		buttonRefs.current[targetIndex]?.focus();
	}, [actions]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				onClose();
				return;
			}
			if (!allowsBubbleKey(event)) return;

			// Check key equivalents
			for (let i = 0; i < actions.length; i++) {
				const action = actions[i]!;
				const matchesKey =
					action.keyEquivalents?.includes(event.key) || String(i + 1) === event.key;
				if (matchesKey) {
					event.preventDefault();
					event.stopPropagation();
					action.onTrigger();
					return;
				}
			}

			if (event.key === "Enter") {
				event.preventDefault();
				event.stopPropagation();
				const focusedIndex = buttonRefs.current.findIndex(
					(el) => el === document.activeElement,
				);
				if (focusedIndex >= 0 && actions[focusedIndex]) {
					actions[focusedIndex]!.onTrigger();
				} else {
					const primary = actions.find((a) => a.isPrimary) ?? actions[0];
					primary?.onTrigger();
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown, true);
		return () => {
			window.removeEventListener("keydown", handleKeyDown, true);
		};
	}, [actions, onClose]);

	return (
		<div
			className={styles.bubble}
			role="toolbar"
			aria-label={strings.settingsHeading}
			tabIndex={-1}
		>
			{actions.map((action, index) => {
				const isPrimary = action.isPrimary ?? index === 0;
				const hint =
					action.hint ??
					(action.keyEquivalents?.[0]
						? `[${action.keyEquivalents[0]}]`
						: isPrimary
							? "[↵]"
							: undefined);
				return (
					<button
						key={action.id}
						ref={(el) => {
							buttonRefs.current[index] = el;
						}}
						type="button"
						className={cls(styles.button, isPrimary && styles.buttonPrimary)}
						onClick={(e) => {
							e.stopPropagation();
							action.onTrigger();
						}}
						title={action.label}
					>
						{action.icon}
						<span>{action.label}</span>
						{hint && <span className={styles.hint}>{hint}</span>}
					</button>
				);
			})}
		</div>
	);
});
