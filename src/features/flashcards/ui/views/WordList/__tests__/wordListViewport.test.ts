import { describe, expect, it } from "vitest";
import type { WordListItem } from "../../../../domain/wordList/wordListPresentationModel";
import { WordListViewport } from "../wordListViewport";
import type {
	WordListViewportDomAdapter,
	WordListViewportDomMount,
	WordListViewportMetrics,
} from "../wordListViewportDom";

function item(id: string, front = id): WordListItem {
	return { id, front, back: `back:${id}`, explanation: `explanation:${id}`, index: 0 };
}

function element(name: string): HTMLElement {
	return { name } as unknown as HTMLElement;
}

interface ScheduledFrame {
	callback: () => void;
	cancelled: boolean;
}

class FakeMount implements WordListViewportDomMount {
	readonly observed = new Set<HTMLElement>();
	readonly unobserved: HTMLElement[] = [];
	readonly frames: ScheduledFrame[] = [];
	readonly heights = new Map<HTMLElement, number>();
	readHeightCount = 0;
	disposed = false;
	metrics: WordListViewportMetrics = { scrollTop: 0, height: 100, width: 100, gap: 12 };

	constructor(readonly changed: { viewport(): void; row(element: HTMLElement): void }) {}

	readViewport = (): WordListViewportMetrics => this.metrics;
	readHeight = (row: HTMLElement): number => {
		this.readHeightCount += 1;
		return this.heights.get(row) ?? 118;
	};
	observeRow = (row: HTMLElement): void => {
		this.observed.add(row);
	};
	unobserveRow = (row: HTMLElement): void => {
		this.observed.delete(row);
		this.unobserved.push(row);
	};
	requestFrame = (callback: () => void): (() => void) => {
		const frame = { callback, cancelled: false };
		this.frames.push(frame);
		return () => {
			frame.cancelled = true;
		};
	};
	dispose = (): void => {
		this.disposed = true;
	};

	flushNext(includeCancelled = false): void {
		const frame = this.frames.find((candidate) => includeCancelled || !candidate.cancelled);
		if (!frame) throw new Error("Expected a scheduled frame");
		this.frames.splice(this.frames.indexOf(frame), 1);
		frame.callback();
	}
}

class FakeAdapter implements WordListViewportDomAdapter {
	readonly mounts: FakeMount[] = [];
	mount(
		_scroll: HTMLElement,
		_list: HTMLElement,
		changed: FakeMount["changed"],
	): WordListViewportDomMount {
		const mount = new FakeMount(changed);
		this.mounts.push(mount);
		return mount;
	}
}

function mounted(items: readonly WordListItem[]) {
	const adapter = new FakeAdapter();
	const viewport = new WordListViewport(items, adapter);
	viewport.refs.scroll(element("scroll") as HTMLDivElement);
	viewport.refs.list(element("list") as HTMLDivElement);
	const cleanup = viewport.mount();
	const mount = adapter.mounts[0]!;
	return { adapter, viewport, mount, cleanup };
}

describe("WordListViewport", () => {
	it("batches same-frame measurements into one publication and exposes immutable default geometry", () => {
		const items = Array.from({ length: 25 }, (_, index) => item(`row-${index}`));
		const { viewport, mount } = mounted(items);
		const first = element("first");
		const second = element("second");
		mount.heights.set(first, 140);
		mount.heights.set(second, 160);
		viewport.refs.row("row-0")(first as HTMLDivElement);
		viewport.refs.row("row-1")(second as HTMLDivElement);
		let publications = 0;
		viewport.subscribe(() => (publications += 1));

		mount.flushNext();

		const snapshot = viewport.getSnapshot();
		expect(publications).toBe(1);
		expect(snapshot.totalHeight).toBe(3_302);
		expect(snapshot.rows.map((row) => [row.item.id, row.top, row.height])).toEqual([
			["row-0", 0, 140],
			["row-1", 152, 160],
			["row-2", 324, 118],
			["row-3", 454, 118],
			["row-4", 584, 118],
			["row-5", 714, 118],
			["row-6", 844, 118],
			["row-7", 974, 118],
			["row-8", 1_104, 118],
		]);
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.rows)).toBe(true);
		expect(Object.isFrozen(snapshot.rows[0])).toBe(true);
		expect(Object.isFrozen(snapshot.rows[0]?.item)).toBe(true);

		mount.changed.viewport();
		mount.flushNext();
		expect(viewport.getSnapshot()).toBe(snapshot);
		expect(publications).toBe(1);
	});

	it("uses eight default-height rows of overscan when scrolling", () => {
		const items = Array.from({ length: 40 }, (_, index) => item(`row-${index}`));
		const { viewport, mount } = mounted(items);
		mount.flushNext();
		mount.metrics = { ...mount.metrics, scrollTop: 2_000 };
		mount.changed.viewport();
		mount.flushNext();

		expect(viewport.getSnapshot().rows.map((row) => row.item.id)).toEqual(
			Array.from({ length: 18 }, (_, index) => `row-${index + 7}`),
		);
	});

	it("remeasures mounted rows on width changes and invalidates cached detached rows", () => {
		const items = [item("a"), item("b"), item("c")];
		const { viewport, mount } = mounted(items);
		const a = element("a");
		const b = element("b");
		const c = element("c");
		mount.heights.set(a, 140);
		mount.heights.set(b, 150);
		mount.heights.set(c, 170);
		viewport.refs.row("a")(a as HTMLDivElement);
		viewport.refs.row("b")(b as HTMLDivElement);
		viewport.refs.row("c")(c as HTMLDivElement);
		mount.flushNext();
		viewport.refs.row("c")(null);
		mount.heights.set(a, 180);
		mount.heights.set(b, 190);
		mount.metrics = { ...mount.metrics, width: 200 };
		mount.changed.viewport();
		mount.flushNext();

		expect(viewport.getSnapshot().rows.map((row) => [row.item.id, row.height])).toEqual([
			["a", 180],
			["b", 190],
			["c", 118],
		]);
	});

	it("replaces item content, removes deleted rows, and recomputes reordered positions", () => {
		const original = [item("a", "old"), item("b"), item("c")];
		const { viewport, mount } = mounted(original);
		const a = element("a");
		const b = element("b");
		const c = element("c");
		mount.heights.set(a, 130);
		mount.heights.set(b, 140);
		mount.heights.set(c, 160);
		viewport.refs.row("a")(a as HTMLDivElement);
		viewport.refs.row("b")(b as HTMLDivElement);
		viewport.refs.row("c")(c as HTMLDivElement);
		mount.flushNext();

		const replacement = item("a", "new");
		mount.heights.set(a, 150);
		viewport.setItems([original[2]!, replacement]);
		mount.flushNext();
		const snapshot = viewport.getSnapshot();
		expect(
			snapshot.rows.map((row) => [
				row.item.id,
				row.item.front,
				row.index,
				row.top,
				row.height,
			]),
		).toEqual([
			["c", "c", 0, 0, 160],
			["a", "new", 1, 172, 150],
		]);
		expect(mount.unobserved).toContain(b as HTMLElement);
		replacement.front = "mutated after publication";
		expect(snapshot.rows[1]?.item.front).toBe("new");
	});

	it("ignores a replaced element's late resize callback", () => {
		const { viewport, mount } = mounted([item("a")]);
		const oldElement = element("old");
		const currentElement = element("current");
		mount.heights.set(oldElement, 140);
		mount.heights.set(currentElement, 160);
		viewport.refs.row("a")(oldElement as HTMLDivElement);
		mount.flushNext();
		viewport.refs.row("a")(currentElement as HTMLDivElement);
		mount.flushNext();
		const snapshot = viewport.getSnapshot();

		mount.changed.row(oldElement);
		expect(mount.frames).toHaveLength(0);
		expect(viewport.getSnapshot()).toBe(snapshot);
		expect(snapshot.rows[0]?.height).toBe(160);
	});

	it("guards callbacks from cancelled and old mounts across setup-cleanup-setup", () => {
		const { adapter, viewport, mount: first, cleanup: firstCleanup } = mounted([item("a")]);
		const row = element("a");
		first.heights.set(row, 140);
		viewport.refs.row("a")(row as HTMLDivElement);
		firstCleanup();
		expect(first.disposed).toBe(true);
		expect(first.frames.some((frame) => frame.cancelled)).toBe(true);
		first.flushNext(true);
		expect(viewport.getSnapshot().rows[0]?.height).toBe(118);

		const secondCleanup = viewport.mount();
		const second = adapter.mounts[1]!;
		second.heights.set(row, 155);
		second.flushNext();
		expect(viewport.getSnapshot().rows[0]?.height).toBe(155);
		const snapshot = viewport.getSnapshot();
		first.changed.viewport();
		first.changed.row(row);
		firstCleanup();
		expect(second.disposed).toBe(false);
		expect(second.frames).toHaveLength(0);
		expect(viewport.getSnapshot()).toBe(snapshot);
		second.changed.viewport();
		secondCleanup();
		expect(second.frames.some((frame) => frame.cancelled)).toBe(true);
		second.flushNext(true);
		expect(viewport.getSnapshot().rows[0]?.height).toBe(155);
	});

	it("accepts refs before setup and reconnects them after ref cleanup replay", () => {
		const adapter = new FakeAdapter();
		const viewport = new WordListViewport([item("a")], adapter);
		const scroll = element("scroll") as HTMLDivElement;
		const list = element("list") as HTMLDivElement;
		const row = element("row") as HTMLDivElement;
		const rowRef = viewport.refs.row("a");
		rowRef(row);
		viewport.refs.list(list);
		viewport.refs.scroll(scroll);
		expect(adapter.mounts).toHaveLength(0);
		const cleanup = viewport.mount();
		const first = adapter.mounts[0]!;
		first.heights.set(row, 140);
		first.flushNext();
		expect(viewport.getSnapshot().totalHeight).toBe(140);

		viewport.refs.scroll(null);
		viewport.refs.list(null);
		rowRef(null);
		cleanup();
		rowRef(row);
		viewport.refs.list(list);
		viewport.refs.scroll(scroll);
		const release = viewport.mount();
		const next = adapter.mounts[1]!;
		next.heights.set(row, 160);
		next.flushNext();
		expect(viewport.refs.row("a")).toBe(rowRef);
		expect(viewport.getSnapshot().totalHeight).toBe(160);
		release();
	});

	it("keeps unchanged row content stable and handles an emptied list with pending work", () => {
		const { viewport, mount } = mounted([item("a"), item("b")]);
		const row = element("a") as HTMLDivElement;
		viewport.refs.row("a")(row);
		mount.flushNext();
		const initial = viewport.getSnapshot();
		mount.heights.set(row, 118.5);
		mount.changed.row(row);
		mount.flushNext();
		expect(viewport.getSnapshot()).toBe(initial);
		mount.heights.set(row, 145);
		mount.changed.row(row);
		mount.flushNext();
		expect(viewport.getSnapshot().rows[0]?.item).toBe(initial.rows[0]?.item);
		mount.changed.row(row);
		viewport.setItems([]);
		mount.flushNext();
		expect(viewport.getSnapshot()).toEqual({ rows: [], totalHeight: 0 });
		mount.changed.row(row);
		expect(mount.frames).toHaveLength(0);
	});

	it("retains the previous valid gap and ignores invalid measurements", () => {
		const { viewport, mount } = mounted([item("a"), item("b")]);
		const a = element("a");
		mount.heights.set(a, 0);
		viewport.refs.row("a")(a as HTMLDivElement);
		mount.metrics = { ...mount.metrics, gap: 16 };
		mount.flushNext();
		expect(viewport.getSnapshot().rows.map((row) => [row.top, row.height])).toEqual([
			[0, 118],
			[134, 118],
		]);

		mount.heights.set(a, Number.NaN);
		mount.metrics = { ...mount.metrics, gap: -1 };
		mount.changed.viewport();
		mount.changed.row(a);
		mount.flushNext();
		expect(viewport.getSnapshot().rows.map((row) => row.top)).toEqual([0, 134]);
	});
});
