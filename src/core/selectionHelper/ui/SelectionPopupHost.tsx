import React, {
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import type { SelectionHelper } from "../domain/selectionHelper";
import type { SelectionHelperStrings } from "../strings/selectionPopup";
import { SelectionBubble, type SelectionBubbleActionItem } from "./SelectionBubble";
import styles from "./SelectionPopup.module.scss";
import { PopupPlacementController, type PopupPositionSnapshot } from "./popupPlacementController";
import type { Language } from "../../shared/types";
import type { SelectionSlotRenderer } from "../domain/types";

export interface SelectionPopupHostProps {
	helper: SelectionHelper;
	strings: SelectionHelperStrings;
	language: Language;
	theme: "dark" | "light";
	slots?: Record<string, SelectionSlotRenderer>;
}

export const SelectionPopupHost: React.FC<SelectionPopupHostProps> = ({
	helper,
	strings,
	language,
	theme: _theme,
	slots,
}) => {
	const subscribe = useCallback((listener: () => void) => helper.subscribe(listener), [helper]);
	const getSnapshot = useCallback(() => helper.getSnapshot(), [helper]);
	const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	const target = state.target;
	const mode = state.mode;

	const rootRef = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState<PopupPositionSnapshot>({
		left: 0,
		top: 0,
		maxWidth: 570,
		maxHeight: 420,
	});
	const controllerRef = useRef<PopupPlacementController | null>(null);
	const onHeaderPointerDown = useCallback<React.PointerEventHandler<HTMLElement>>((event) => {
		controllerRef.current?.onHeaderPointerDown?.(event);
	}, []);

	useLayoutEffect(() => {
		const element = rootRef.current;
		const ownerWindow = element?.ownerDocument.defaultView;
		if (!element || !ownerWindow || !target) return;

		const controller = new PopupPlacementController({
			element,
			ownerWindow,
			target,
			mode,
			onPositionChange: (next) => {
				setPosition((current) =>
					current.left === next.left &&
					current.top === next.top &&
					current.maxWidth === next.maxWidth &&
					current.maxHeight === next.maxHeight
						? current
						: next,
				);
			},
		});

		controllerRef.current = controller;

		return () => {
			controllerRef.current = null;
			controller.dispose();
		};
	}, [target, mode]);

	const bubbleActions = useMemo<readonly SelectionBubbleActionItem[]>(() => {
		if (mode !== "actions" || state.eligibleActionIds.length === 0) return [];
		const eligible = helper.eligibleActions ?? [];
		return eligible.map((action) => ({
			id: action.id,
			label: action.label(language),
			icon: action.icon,
			hint: action.hint,
			isPrimary: action.isPrimary,
			keyEquivalents: action.keyEquivalents,
			onTrigger: () => {
				void helper.triggerAction(action.id);
			},
		}));
	}, [helper, mode, language, state.eligibleActionIds]);

	if (!target) return null;

	const slotRenderer = state.activeSlotId ? slots?.[state.activeSlotId] : undefined;

	return (
		<div
			ref={rootRef}
			className={styles.root}
			style={
				{
					left: position.left,
					top: position.top,
					maxWidth: position.maxWidth,
					"--fc-selection-max-height": `${position.maxHeight}px`,
					"--fc-selection-max-width": `${position.maxWidth}px`,
				} as React.CSSProperties
			}
		>
			{mode === "actions" ? (
				<SelectionBubble
					actions={bubbleActions}
					strings={strings}
					onClose={() => helper.dismiss()}
				/>
			) : (
				/* oxlint-disable-next-line react/refs -- Slot renderer receives pointerdown forwarder for dragging */
				slotRenderer?.({
					word: target.text,
					text: target.text,
					onClose: () => helper.dismiss(),
					onHeaderPointerDown,
					selectedDictionaries: helper.selectedDictionaries,
					dictionaryOrder: helper.dictionaryOrder,
					openMainShortcut: helper.openMainShortcut,
				})
			)}
		</div>
	);
};
