import { describe, expect, it, vi } from "vite-plus/test";
import { SortableInteraction, type SortableInput, type SortableMove } from "../sortableInteraction";

function deferred() {
	let resolve!: () => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<void>((accept, fail) => {
		resolve = accept;
		reject = fail;
	});
	return { promise, resolve, reject };
}

async function settle() {
	await Promise.resolve();
	await Promise.resolve();
}

function harness(options: Partial<SortableInput> = {}) {
	const save = deferred();
	const onMove = vi.fn((_move: SortableMove) => save.promise);
	let input: SortableInput = { items: ["a", "b", "c"], onMove, ...options };
	const interaction = new SortableInteraction(input);
	const cleanup = interaction.mount();
	function update(next: Partial<SortableInput>) {
		input = { ...input, ...next };
		interaction.update(input);
	}
	return { interaction, cleanup, update, onMove, save };
}

describe("SortableInteraction", () => {
	it("submits one move and immediately locks repeated button and drag input", async () => {
		const { interaction, onMove, save } = harness();
		interaction.beginDrag("b");
		interaction.move("a", "c");
		interaction.move("b", "a");
		interaction.drop("b", "a");
		interaction.beginDrag("c");
		interaction.drop("c", "a");
		expect(onMove).toHaveBeenCalledExactlyOnceWith({
			activeId: "a",
			overId: "c",
			items: ["b", "c", "a"],
		});
		expect(interaction.getSnapshot()).toEqual({
			items: ["a", "b", "c"],
			busy: true,
			disabled: true,
		});
		save.resolve();
		await settle();
		expect(interaction.getSnapshot()).toEqual({
			items: ["a", "b", "c"],
			busy: false,
			disabled: false,
		});
	});

	it("a drag submission acquires the same lock used by buttons", () => {
		const { interaction, onMove } = harness();
		interaction.beginDrag("c");
		interaction.drop("c", "a");
		interaction.move("a", "b");
		expect(onMove).toHaveBeenCalledExactlyOnceWith({
			activeId: "c",
			overId: "a",
			items: ["c", "a", "b"],
		});
	});

	it.each([
		["a", "a"],
		["missing", "b"],
		["a", "missing"],
	])("ignores invalid or unchanged moves from %s to %s", (active, over) => {
		const { interaction, onMove } = harness();
		const before = interaction.getSnapshot();
		interaction.move(active, over);
		interaction.beginDrag(active);
		interaction.drop(active, over);
		expect(onMove).not.toHaveBeenCalled();
		expect(interaction.getSnapshot()).toBe(before);
	});

	it("requires a matching active drag and discards cancelled or outside drops", () => {
		const { interaction, onMove } = harness();
		interaction.drop("a", "b");
		interaction.beginDrag("a");
		interaction.drop("b", "c");
		interaction.beginDrag("a");
		interaction.drop("a", null);
		interaction.drop("a", "b");
		interaction.beginDrag("a");
		interaction.cancelDrag();
		interaction.drop("a", "b");
		expect(onMove).not.toHaveBeenCalled();
	});

	it("preserves an active drag through same-content arrays and callback updates", () => {
		const { interaction, update, onMove } = harness();
		const replacement = vi.fn();
		interaction.beginDrag("a");
		update({ items: ["a", "b", "c"], onMove: replacement });
		interaction.drop("a", "c");
		expect(onMove).not.toHaveBeenCalled();
		expect(replacement).toHaveBeenCalledExactlyOnceWith({
			activeId: "a",
			overId: "c",
			items: ["b", "c", "a"],
		});
	});

	it.each([
		["b", "a", "c"],
		["a", "b"],
		["a", "b", "c", "d"],
	])(
		"invalidates an unsubmitted drag after ordered IDs change to %j, even if restored",
		(...items) => {
			const { interaction, update, onMove } = harness();
			interaction.beginDrag("a");
			update({ items });
			update({ items: ["a", "b", "c"] });
			interaction.drop("a", "c");
			expect(onMove).not.toHaveBeenCalled();
		},
	);

	it("disabling invalidates a drag and blocks buttons until enabled", () => {
		const { interaction, update, onMove } = harness();
		interaction.beginDrag("a");
		update({ disabled: true });
		interaction.move("a", "b");
		interaction.beginDrag("a");
		update({ disabled: false });
		interaction.drop("a", "c");
		expect(onMove).not.toHaveBeenCalled();
		interaction.move("a", "b");
		expect(onMove).toHaveBeenCalledOnce();
	});

	it.each(["resolve", "reject"] as const)(
		"shows optimistic order, then uses current authority on %s",
		async (outcome) => {
			const error = vi.spyOn(console, "error").mockImplementation(() => {});
			try {
				const { interaction, update, save } = harness({ optimistic: true });
				interaction.move("a", "c");
				expect(interaction.getSnapshot().items).toEqual(["b", "c", "a"]);
				update({ items: ["c", "a", "b"] });
				expect(interaction.getSnapshot()).toEqual({
					items: ["c", "a", "b"],
					busy: true,
					disabled: true,
				});
				if (outcome === "resolve") save.resolve();
				else save.reject(new Error("save failed"));
				await settle();
				expect(interaction.getSnapshot()).toEqual({
					items: ["c", "a", "b"],
					busy: false,
					disabled: false,
				});
			} finally {
				error.mockRestore();
			}
		},
	);

	it("removes an optimistic preview when the owner completes without updating authority", async () => {
		const { interaction, save } = harness({ optimistic: true });
		interaction.move("a", "c");
		save.resolve();
		await settle();
		expect(interaction.getSnapshot().items).toEqual(["a", "b", "c"]);
	});

	it("accepts synchronous owner updates while holding the lock through completion", async () => {
		const owner = vi.fn((move: SortableMove) => {
			update({ items: move.items });
			interaction.move("b", "a");
		});
		const { interaction, update } = harness({ optimistic: true, onMove: owner });
		interaction.move("a", "c");
		expect(owner).toHaveBeenCalledOnce();
		expect(interaction.getSnapshot()).toEqual({
			items: ["b", "c", "a"],
			busy: true,
			disabled: true,
		});
		await settle();
		expect(interaction.getSnapshot()).toEqual({
			items: ["b", "c", "a"],
			busy: false,
			disabled: false,
		});
	});

	it("recovers from a synchronous owner exception and permits retry", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const owner = vi
				.fn()
				.mockImplementationOnce(() => {
					throw new Error("failed");
				})
				.mockResolvedValue(undefined);
			const { interaction } = harness({ onMove: owner, optimistic: true });
			expect(() => interaction.move("a", "b")).not.toThrow();
			expect(interaction.getSnapshot()).toEqual({
				items: ["a", "b", "c"],
				busy: false,
				disabled: false,
			});
			interaction.move("a", "b");
			await settle();
			expect(owner).toHaveBeenCalledTimes(2);
			expect(interaction.getSnapshot().busy).toBe(false);
		} finally {
			error.mockRestore();
		}
	});

	it("handles an asynchronous rejection without retaining its preview or blocking retry", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const { interaction, update, save, onMove } = harness({ optimistic: true });
			interaction.move("a", "c");
			save.reject(new Error("save failed"));
			await settle();
			expect(interaction.getSnapshot()).toEqual({
				items: ["a", "b", "c"],
				busy: false,
				disabled: false,
			});
			const retry = vi.fn();
			update({ onMove: retry });
			interaction.move("a", "b");
			await settle();
			expect(onMove).toHaveBeenCalledOnce();
			expect(retry).toHaveBeenCalledExactlyOnceWith({
				activeId: "a",
				overId: "b",
				items: ["b", "a", "c"],
			});
			expect(interaction.getSnapshot().busy).toBe(false);
		} finally {
			error.mockRestore();
		}
	});

	it("blocks all unsubmitted input before mount and after cleanup", () => {
		const onMove = vi.fn();
		const interaction = new SortableInteraction({ items: ["a", "b"], onMove });
		interaction.move("a", "b");
		interaction.beginDrag("a");
		interaction.drop("a", "b");
		const cleanup = interaction.mount();
		interaction.beginDrag("a");
		cleanup();
		interaction.drop("a", "b");
		interaction.move("a", "b");
		expect(onMove).not.toHaveBeenCalled();
		expect(interaction.getSnapshot().disabled).toBe(true);
	});

	it("lets accepted owner work finish without changing or notifying an unmounted snapshot", async () => {
		const { interaction, cleanup, save, onMove } = harness({ optimistic: true });
		const completed = vi.fn();
		void save.promise.then(completed);
		interaction.move("a", "b");
		cleanup();
		const snapshot = interaction.getSnapshot();
		const notify = vi.fn();
		interaction.subscribe(notify);
		save.resolve();
		await settle();
		expect(onMove).toHaveBeenCalledOnce();
		expect(completed).toHaveBeenCalledOnce();
		expect(interaction.getSnapshot()).toBe(snapshot);
		expect(notify).not.toHaveBeenCalled();
	});

	it("old cleanup and completion cannot unlock a new pending move after mount replay", async () => {
		const first = deferred();
		const second = deferred();
		const owner = vi
			.fn()
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		const { interaction, cleanup } = harness({ onMove: owner });
		interaction.move("a", "b");
		cleanup();
		interaction.mount();
		interaction.move("b", "c");
		const snapshot = interaction.getSnapshot();
		const notify = vi.fn();
		interaction.subscribe(notify);
		cleanup();
		first.resolve();
		await settle();
		expect(interaction.getSnapshot()).toBe(snapshot);
		expect(notify).not.toHaveBeenCalled();
		interaction.move("a", "c");
		expect(owner).toHaveBeenCalledTimes(2);
		second.resolve();
		await settle();
		expect(interaction.getSnapshot().busy).toBe(false);
		expect(notify).toHaveBeenCalledOnce();
	});

	it("keeps snapshots immutable and only notifies observable changes", () => {
		const items = ["a", "b", "c"];
		const { interaction, update } = harness({ items, optimistic: true });
		const initial = interaction.getSnapshot();
		const notify = vi.fn();
		const unsubscribe = interaction.subscribe(notify);
		items.reverse();
		expect(initial.items).toEqual(["a", "b", "c"]);
		expect(Object.isFrozen(initial)).toBe(true);
		expect(Object.isFrozen(initial.items)).toBe(true);
		update({ items: ["a", "b", "c"], onMove: vi.fn() });
		expect(interaction.getSnapshot()).toBe(initial);
		expect(notify).not.toHaveBeenCalled();
		interaction.move("a", "c");
		expect(initial).toEqual({ items: ["a", "b", "c"], busy: false, disabled: false });
		expect(Object.isFrozen(interaction.getSnapshot().items)).toBe(true);
		expect(notify).toHaveBeenCalledOnce();
		unsubscribe();
		update({ items: ["c", "b", "a"] });
		expect(notify).toHaveBeenCalledOnce();
	});
});
