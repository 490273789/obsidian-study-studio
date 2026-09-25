import type { WordListItem } from "../../../domain/wordList/wordListPresentationModel";
import {
	browserWordListViewportDom,
	type WordListViewportDomAdapter,
	type WordListViewportDomMount,
} from "./wordListViewportDom";

const DEFAULT_ROW_HEIGHT = 118;
const DEFAULT_ROW_GAP = 12;
const OVERSCAN_ROWS = 8;

export interface WordListViewportRow {
	readonly item: Readonly<WordListItem>;
	readonly index: number;
	readonly top: number;
	readonly height: number;
}

export interface WordListViewportSnapshot {
	readonly rows: readonly WordListViewportRow[];
	readonly totalHeight: number;
}

/** One view's measurements, geometry and resource lifetime behind one snapshot. */
export class WordListViewport {
	private items: readonly WordListItem[] = [];
	private readonly itemSnapshots = new WeakMap<WordListItem, Readonly<WordListItem>>();
	private readonly heights = new Map<string, number>();
	private readonly elements = new Map<string, HTMLElement>();
	private readonly elementIds = new WeakMap<HTMLElement, string>();
	private readonly rowRefs = new Map<string, (element: HTMLDivElement | null) => void>();
	private readonly dirtyRows = new Set<string>();
	private readonly listeners = new Set<() => void>();
	private scroll: HTMLElement | null = null;
	private list: HTMLElement | null = null;
	private activeLease: object | null = null;
	private dom: WordListViewportDomMount | null = null;
	private cancelFrame: (() => void) | null = null;
	private frameToken: object | null = null;
	private width = 0;
	private height = DEFAULT_ROW_HEIGHT * 10;
	private scrollTop = 0;
	private gap = DEFAULT_ROW_GAP;
	private layout: readonly WordListViewportRow[] = [];
	private totalHeight = 0;
	private snapshot: WordListViewportSnapshot = Object.freeze({
		rows: Object.freeze([]),
		totalHeight: 0,
	});

	constructor(
		items: readonly WordListItem[],
		private readonly adapter: WordListViewportDomAdapter = browserWordListViewportDom,
	) {
		this.setItems(items);
	}

	getSnapshot = (): WordListViewportSnapshot => this.snapshot;
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	readonly refs = {
		scroll: (element: HTMLDivElement | null): void => {
			if (element === this.scroll) return;
			this.disconnect();
			this.scroll = element;
			this.connect();
		},
		list: (element: HTMLDivElement | null): void => {
			if (element === this.list) return;
			this.disconnect();
			this.list = element;
			this.connect();
		},
		row: (id: string): ((element: HTMLDivElement | null) => void) => {
			const existing = this.rowRefs.get(id);
			if (existing) return existing;
			const ref = (element: HTMLDivElement | null): void => {
				if (element) this.rowRefs.set(id, ref);
				else {
					if (this.rowRefs.get(id) !== ref) return;
					this.rowRefs.delete(id);
				}
				this.attachRow(id, element);
			};
			this.rowRefs.set(id, ref);
			return ref;
		},
	};

	/** Reversible setup/cleanup, including React's development setup replay. */
	mount(): () => void {
		this.disconnect();
		const lease = {};
		this.activeLease = lease;
		this.connect();
		return () => {
			if (this.activeLease !== lease) return;
			this.activeLease = null;
			this.disconnect();
		};
	}

	setItems(items: readonly WordListItem[]): void {
		if (items === this.items) return;
		const previous = new Map(this.items.map((item) => [item.id, item]));
		const ids = new Set(items.map((item) => item.id));
		for (const id of previous.keys()) {
			if (ids.has(id)) continue;
			this.heights.delete(id);
			this.attachRow(id, null);
			this.rowRefs.delete(id);
		}
		for (const item of items) {
			if (previous.get(item.id) === item) continue;
			this.heights.delete(item.id);
			this.dirtyRows.add(item.id);
		}
		this.items = items;
		this.rebuildLayout();
		this.publish();
		this.schedule();
	}

	private attachRow(id: string, element: HTMLElement | null): void {
		const previous = this.elements.get(id);
		if (previous === element) return;
		if (previous) {
			this.dom?.unobserveRow(previous);
			this.elementIds.delete(previous);
			this.elements.delete(id);
		}
		this.dirtyRows.delete(id);
		if (!element) return;
		this.elements.set(id, element);
		this.elementIds.set(element, id);
		this.dom?.observeRow(element);
		this.dirtyRows.add(id);
		this.schedule();
	}

	private connect(): void {
		if (!this.activeLease || !this.scroll || !this.list || this.dom) return;
		const dom = this.adapter.mount(this.scroll, this.list, {
			viewport: () => {
				if (this.dom === dom) this.schedule();
			},
			row: (element) => {
				if (this.dom !== dom) return;
				const id = this.elementIds.get(element);
				if (id === undefined) return;
				this.dirtyRows.add(id);
				this.schedule();
			},
		});
		this.dom = dom;
		for (const [id, element] of this.elements) {
			dom.observeRow(element);
			this.dirtyRows.add(id);
		}
		this.schedule();
	}

	private disconnect(): void {
		this.frameToken = null;
		this.cancelFrame?.();
		this.cancelFrame = null;
		const dom = this.dom;
		this.dom = null;
		dom?.dispose();
		this.dirtyRows.clear();
	}

	private schedule(): void {
		const dom = this.dom;
		if (!dom || this.frameToken) return;
		const token = {};
		this.frameToken = token;
		this.cancelFrame = dom.requestFrame(() => {
			if (this.dom !== dom || this.frameToken !== token) return;
			this.frameToken = null;
			this.cancelFrame = null;
			this.flush(dom);
		});
	}

	private flush(dom: WordListViewportDomMount): void {
		const viewport = dom.readViewport();
		let layoutChanged = false;
		if (viewport.width !== this.width) {
			this.width = viewport.width;
			this.heights.clear();
			for (const id of this.elements.keys()) this.dirtyRows.add(id);
			layoutChanged = true;
		}
		if (
			Number.isFinite(viewport.gap) &&
			viewport.gap >= 0 &&
			Math.abs(this.gap - viewport.gap) > 0.5
		) {
			this.gap = viewport.gap;
			layoutChanged = true;
		}
		this.height = viewport.height;
		this.scrollTop = viewport.scrollTop;
		// Read at flush time: no queued height from an old width or detached node survives.
		for (const id of this.dirtyRows) {
			const element = this.elements.get(id);
			if (!element) continue;
			const measured = dom.readHeight(element);
			if (!Number.isFinite(measured) || measured <= 0) continue;
			const previous = this.heights.get(id);
			if (previous !== undefined && Math.abs(previous - measured) <= 1) continue;
			this.heights.set(id, measured);
			layoutChanged = true;
		}
		this.dirtyRows.clear();
		if (layoutChanged) this.rebuildLayout();
		this.publish();
	}

	private rebuildLayout(): void {
		let top = 0;
		this.layout = this.items.map((item, index) => {
			const height = this.heights.get(item.id) ?? DEFAULT_ROW_HEIGHT;
			let itemSnapshot = this.itemSnapshots.get(item);
			if (!itemSnapshot) {
				itemSnapshot = Object.freeze({ ...item });
				this.itemSnapshots.set(item, itemSnapshot);
			}
			const previous = this.layout[index];
			const row =
				previous?.item === itemSnapshot &&
				previous.top === top &&
				previous.height === height
					? previous
					: Object.freeze({ item: itemSnapshot, index, top, height });
			top += height + this.gap;
			return row;
		});
		this.totalHeight = Math.max(0, top - this.gap);
	}

	private publish(): void {
		const overscan = (DEFAULT_ROW_HEIGHT + this.gap) * OVERSCAN_ROWS;
		const start = firstRowEndingAt(this.layout, this.scrollTop - overscan);
		const end = firstRowStartingAfter(this.layout, this.scrollTop + this.height + overscan);
		const rows = this.layout.slice(start, end);
		if (
			this.totalHeight === this.snapshot.totalHeight &&
			rows.length === this.snapshot.rows.length &&
			rows.every((row, i) => row === this.snapshot.rows[i])
		)
			return;
		this.snapshot = Object.freeze({ rows: Object.freeze(rows), totalHeight: this.totalHeight });
		for (const listener of this.listeners) listener();
	}
}

function firstRowEndingAt(rows: readonly WordListViewportRow[], top: number): number {
	let low = 0;
	let high = rows.length;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		const row = rows[middle]!;
		if (row.top + row.height >= top) high = middle;
		else low = middle + 1;
	}
	return low;
}

function firstRowStartingAfter(rows: readonly WordListViewportRow[], bottom: number): number {
	let low = 0;
	let high = rows.length;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (rows[middle]!.top > bottom) high = middle;
		else low = middle + 1;
	}
	return low;
}
