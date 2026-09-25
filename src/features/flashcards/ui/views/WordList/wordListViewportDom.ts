export interface WordListViewportMetrics {
	readonly scrollTop: number;
	readonly height: number;
	readonly width: number;
	readonly gap: number;
}

/** Internal browser seam; layout policy belongs to WordListViewport. */
export interface WordListViewportDomMount {
	readViewport(): WordListViewportMetrics;
	readHeight(element: HTMLElement): number;
	observeRow(element: HTMLElement): void;
	unobserveRow(element: HTMLElement): void;
	requestFrame(callback: () => void): () => void;
	dispose(): void;
}

export interface WordListViewportDomAdapter {
	mount(
		scroll: HTMLElement,
		list: HTMLElement,
		changed: { viewport(): void; row(element: HTMLElement): void },
	): WordListViewportDomMount;
}

export const browserWordListViewportDom: WordListViewportDomAdapter = {
	mount(scroll, list, changed) {
		const win = scroll.ownerDocument.defaultView!;
		// Use the element's window, including an Obsidian pop-out window.
		const Observer = (win as Window & typeof globalThis).ResizeObserver;
		const viewportObserver = new Observer(() => changed.viewport());
		const rowObserver = new Observer((entries) => {
			for (const entry of entries) changed.row(entry.target as HTMLElement);
		});
		viewportObserver.observe(scroll);
		scroll.addEventListener("scroll", changed.viewport, { passive: true });
		return {
			readViewport: () => ({
				scrollTop: scroll.scrollTop,
				height: scroll.clientHeight,
				width: scroll.clientWidth,
				gap: Number.parseFloat(win.getComputedStyle(list).gap),
			}),
			readHeight: (element) => element.getBoundingClientRect().height,
			observeRow: (element) => rowObserver.observe(element),
			unobserveRow: (element) => rowObserver.unobserve(element),
			requestFrame: (callback) => {
				const id = win.requestAnimationFrame(callback);
				return () => win.cancelAnimationFrame(id);
			},
			dispose: () => {
				scroll.removeEventListener("scroll", changed.viewport);
				viewportObserver.disconnect();
				rowObserver.disconnect();
			},
		};
	},
};
