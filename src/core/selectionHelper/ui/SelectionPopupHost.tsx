import React, { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SelectionHelper } from "../domain/selectionHelper";
import type { SelectionHelperStrings } from "../strings/selectionPopup";
import { SelectionBubble } from "./SelectionBubble";
import { SelectionDictCard } from "./SelectionDictCard";
import styles from "./SelectionPopup.module.scss";
import { popupPosition } from "./popupPosition";
import type { SelectionEmbeddedContentRenderer } from "./types";

export interface SelectionPopupHostProps {
	helper: SelectionHelper;
	strings: SelectionHelperStrings;
	theme: "dark" | "light";
	renderEmbeddedContent?: SelectionEmbeddedContentRenderer;
}

export const SelectionPopupHost: React.FC<SelectionPopupHostProps> = ({
	helper,
	strings,
	theme,
	renderEmbeddedContent,
}) => {
	const subscribe = useCallback((listener: () => void) => helper.subscribe(listener), [helper]);
	const getSnapshot = useCallback(() => helper.getSnapshot(), [helper]);
	const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	const target = state.target;
	const mode = state.mode;

	const rootRef = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState({ left: 0, top: 0, maxWidth: 380, maxHeight: 420 });

	useLayoutEffect(() => {
		const element = rootRef.current;
		const ownerWindow = element?.ownerDocument.defaultView;
		if (!element || !ownerWindow || !target) return;
		const measure = () => {
			const viewport = ownerWindow.visualViewport;
			const next = popupPosition(
				target,
				{
					width: element.offsetWidth,
					height: element.offsetHeight,
				},
				{
					left: viewport?.offsetLeft ?? 0,
					top: viewport?.offsetTop ?? 0,
					width: viewport?.width ?? ownerWindow.innerWidth,
					height: viewport?.height ?? ownerWindow.innerHeight,
				},
			);
			setPosition((current) =>
				current.left === next.left &&
				current.top === next.top &&
				current.maxWidth === next.maxWidth &&
				current.maxHeight === next.maxHeight
					? current
					: next,
			);
		};
		const Observer = (ownerWindow as Window & { ResizeObserver?: typeof ResizeObserver })
			.ResizeObserver;
		const observer = Observer ? new Observer(measure) : null;
		observer?.observe(element);
		ownerWindow.addEventListener("resize", measure);
		ownerWindow.visualViewport?.addEventListener("resize", measure);
		ownerWindow.visualViewport?.addEventListener("scroll", measure);
		measure();
		return () => {
			observer?.disconnect();
			ownerWindow.removeEventListener("resize", measure);
			ownerWindow.visualViewport?.removeEventListener("resize", measure);
			ownerWindow.visualViewport?.removeEventListener("scroll", measure);
		};
	}, [target, mode]);

	if (!target) return null;

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
					canLookup={state.canLookup}
					canTranslate={state.canTranslate}
					strings={strings}
					onLookup={() => helper.beginLookup()}
					onTranslate={() => void helper.translate()}
					onClose={() => helper.dismiss()}
				/>
			) : state.lookup ? (
				<SelectionDictCard
					query={state.lookup.query}
					lookup={state.lookup}
					theme={theme}
					renderEmbeddedContent={renderEmbeddedContent}
					strings={strings}
					onSelectSource={(sourceId) => helper.selectSource(sourceId)}
					onSelectSection={(sourceId, index) => helper.selectSection(sourceId, index)}
					onLookup={(word) => void helper.lookup(word)}
					onRetry={(sourceId) => void helper.retry(sourceId)}
					onGenerateAi={() => void helper.generateAi()}
					onOpenInMainTab={() => void helper.openDictionaryInMainTab()}
					onClose={() => helper.dismiss()}
				/>
			) : null}
		</div>
	);
};
