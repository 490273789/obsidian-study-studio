import type { ViewState } from "../../../core/shared/types";

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

/**
 * The part of the presented lifecycle the page identity needs. Keeping it
 * structural lets the transition rules stay a pure function that tests can
 * drive without building a whole session snapshot.
 */
export interface PageLifecycle {
	readonly kind: "idle" | "active" | "result";
	readonly mode?: "study" | "practice" | "spelling" | "challenge";
}

/**
 * Route depth from the landing page. Setup, word-list, and stats pages sit one
 * level in; live and finished sessions sit one level deeper.
 */
const ROUTE_DEPTH: Record<ViewState["type"], number> = {
	home: 0,
	// The challenge setup overlay is drawn over the landing page, so it is the
	// landing page as far as page transitions are concerned.
	"challenge-setup": 0,
	stats: 1,
	"word-list": 1,
	"study-setup": 1,
	"practice-setup": 1,
	"spelling-setup": 1,
};

const SESSION_DEPTH = 2;

const INITIAL: PageTransition = Object.freeze({
	key: "",
	depth: 0,
	direction: "replace",
});

/**
 * A stable identity for the page on screen. Views that stay on the same page
 * keep their key, so card progress, settings updates, and the challenge setup
 * overlay do not replay the entrance animation or remount the page.
 */
export function pageKeyFor(view: ViewState, lifecycle: PageLifecycle): string {
	if (lifecycle.kind !== "idle") {
		return lifecycle.mode ? `${lifecycle.kind}:${lifecycle.mode}` : lifecycle.kind;
	}
	if (view.type === "challenge-setup") return "home";
	return "deckId" in view ? `${view.type}:${view.deckId}` : view.type;
}

/** How deep the page sits relative to the landing page. */
export function pageDepthFor(view: ViewState, lifecycle: PageLifecycle): number {
	if (lifecycle.kind !== "idle") return SESSION_DEPTH;
	return ROUTE_DEPTH[view.type];
}

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
	resolve(view: ViewState, lifecycle: PageLifecycle): PageTransition {
		const key = pageKeyFor(view, lifecycle);
		if (key === this.current.key) return this.current;

		const depth = pageDepthFor(view, lifecycle);
		const direction: PageTransitionDirection =
			depth === this.current.depth
				? "replace"
				: depth > this.current.depth
					? "forward"
					: "backward";
		this.current = Object.freeze({ key, depth, direction });
		return this.current;
	}
}
