import { useCallback, useEffect, useRef, type RefObject } from "react";

/** Keep a session's input and action dock above its owning window's soft keyboard. */
export function useSessionInputVisibility(
	inputRef: RefObject<HTMLInputElement | null>,
	viewRef: RefObject<HTMLDivElement | null>,
) {
	const frame = useRef<number | null>(null);
	const keepInputVisible = useCallback(() => {
		const input = inputRef.current;
		const view = viewRef.current;
		const ownerWindow = input?.ownerDocument.defaultView;
		if (!input || !view || !ownerWindow || input.ownerDocument.activeElement !== input) return;
		const viewport = ownerWindow.visualViewport;
		const bottom = viewport ? viewport.offsetTop + viewport.height : ownerWindow.innerHeight;
		const inset = Math.max(0, view.getBoundingClientRect().bottom - bottom);
		view.style.setProperty("--fc-keyboard-inset", `${inset}px`);
		if (frame.current !== null) ownerWindow.cancelAnimationFrame(frame.current);
		frame.current = ownerWindow.requestAnimationFrame(() => {
			frame.current = null;
			if (inputRef.current !== input || input.ownerDocument.activeElement !== input) return;
			const scroller = input.closest<HTMLElement>(".flashcard-content");
			if (!scroller) return;
			const overlap =
				input.getBoundingClientRect().bottom +
				16 -
				Math.min(scroller.getBoundingClientRect().bottom, bottom);
			if (overlap > 0) scroller.scrollBy({ top: overlap, behavior: "auto" });
		});
	}, [inputRef, viewRef]);
	const handleInputBlur = useCallback(() => {
		viewRef.current?.style.removeProperty("--fc-keyboard-inset");
	}, [viewRef]);
	useEffect(() => {
		const ownerWindow = inputRef.current?.ownerDocument.defaultView;
		const view = viewRef.current;
		if (!ownerWindow) return;
		const viewport = ownerWindow.visualViewport;
		viewport?.addEventListener("resize", keepInputVisible);
		viewport?.addEventListener("scroll", keepInputVisible);
		return () => {
			viewport?.removeEventListener("resize", keepInputVisible);
			viewport?.removeEventListener("scroll", keepInputVisible);
			if (frame.current !== null) ownerWindow.cancelAnimationFrame(frame.current);
			frame.current = null;
			view?.style.removeProperty("--fc-keyboard-inset");
		};
	}, [inputRef, viewRef, keepInputVisible]);
	return { keepInputVisible, handleInputBlur };
}
