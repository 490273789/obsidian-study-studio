/** Which side of the current page the next page sits on. */
export type PageTransitionDirection = "forward" | "backward" | "replace";

/** The page identity and entrance direction handed to the rendering shell. */
export interface PageTransition {
	/** Stable identity of the page on screen; changing it replays the entrance. */
	readonly key: string;
	/** How deep the page sits in the route hierarchy; drives the direction. */
	readonly depth: number;
	readonly direction: PageTransitionDirection;
}

/** The route-table page identity the tracker needs; it owns no route knowledge. */
export interface PageIdentity {
	readonly key: string;
	readonly depth: number;
}

const INITIAL: PageTransition = Object.freeze({
	key: "",
	depth: 0,
	direction: "replace",
});

/**
 * Remembers the page that was rendered last so the next page knows whether it
 * was reached by going deeper (forward), coming back (backward), or replacing
 * a sibling page. One tracker belongs to one mounted flashcard view.
 */
export class PageTransitionTracker {
	private current: PageTransition = INITIAL;

	/**
	 * Idempotent for repeated renders of the same page, so a discarded render
	 * (StrictMode, interrupted work) cannot advance the remembered page.
	 */
	resolve(page: PageIdentity): PageTransition {
		if (page.key === this.current.key) return this.current;

		const direction: PageTransitionDirection =
			page.depth === this.current.depth
				? "replace"
				: page.depth > this.current.depth
					? "forward"
					: "backward";
		this.current = Object.freeze({ key: page.key, depth: page.depth, direction });
		return this.current;
	}
}
