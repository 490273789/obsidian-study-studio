export interface SortableMove {
	readonly activeId: string;
	readonly overId: string;
	readonly items: readonly string[];
}

export interface SortableInput {
	readonly items: readonly string[];
	readonly disabled?: boolean;
	readonly optimistic?: boolean;
	readonly onMove: (move: SortableMove) => void | Promise<void>;
}

interface SortableSnapshot {
	readonly items: readonly string[];
	readonly busy: boolean;
	readonly disabled: boolean;
}

/** View-local interaction only. The owner retains ordering rules and accepted writes. */
export class SortableInteraction {
	private input: SortableInput;
	private active = false;
	private lifetime: object | null = null;
	private drag: { readonly id: string } | null = null;
	private pending: object | null = null;
	private preview: readonly string[] | null = null;
	private snapshot: SortableSnapshot;
	private readonly listeners = new Set<() => void>();

	constructor(input: SortableInput) {
		this.input = { ...input, items: Object.freeze([...input.items]) };
		this.snapshot = this.buildSnapshot();
	}

	readonly getSnapshot = (): SortableSnapshot => this.snapshot;

	readonly subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	/** Supports mount/cleanup/mount replay without reviving an old completion. */
	mount(): () => void {
		const lifetime = {};
		this.lifetime = lifetime;
		this.active = true;
		this.publish();
		return () => {
			if (this.lifetime !== lifetime) return;
			this.active = false;
			this.drag = null;
			this.pending = null;
			this.preview = null;
			this.snapshot = this.buildSnapshot();
		};
	}

	update(input: SortableInput): void {
		const changed = !sameItems(this.input.items, input.items);
		this.input = {
			...input,
			items: changed ? Object.freeze([...input.items]) : this.input.items,
		};
		if (changed || input.disabled) this.drag = null;
		// A new authoritative order supersedes a local preview, not an accepted write.
		if (changed || !input.optimistic) this.preview = null;
		this.publish();
	}

	readonly beginDrag = (activeId: string): void => {
		this.drag = this.canMove() && this.input.items.includes(activeId) ? { id: activeId } : null;
	};

	readonly cancelDrag = (): void => {
		this.drag = null;
	};

	readonly drop = (activeId: string, overId: string | null): void => {
		const drag = this.drag;
		this.drag = null;
		if (drag?.id === activeId && overId !== null) this.move(activeId, overId);
	};

	readonly move = (activeId: string, overId: string): void => {
		if (!this.canMove() || activeId === overId) return;
		const items = [...this.input.items];
		const from = items.indexOf(activeId);
		const to = items.indexOf(overId);
		if (from < 0 || to < 0) return;
		items.splice(to, 0, ...items.splice(from, 1));
		const move = Object.freeze({ activeId, overId, items: Object.freeze(items) });
		const pending = {};
		const onMove = this.input.onMove;
		this.pending = pending;
		this.drag = null;
		this.preview = this.input.optimistic ? move.items : null;
		this.publish();
		// Acquire the lock before calling the owner, even if it publishes synchronously.
		try {
			void Promise.resolve(onMove(move)).then(
				() => this.finish(pending),
				(error: unknown) => {
					console.error("Reorder failed:", error);
					this.finish(pending);
				},
			);
		} catch (error) {
			console.error("Reorder failed:", error);
			this.finish(pending);
		}
	};

	private canMove(): boolean {
		return this.active && !this.input.disabled && this.pending === null;
	}

	private finish(pending: object): void {
		if (!this.active || this.pending !== pending) return;
		this.pending = null;
		this.preview = null;
		this.publish();
	}

	private buildSnapshot(): SortableSnapshot {
		return Object.freeze({
			items: this.preview ?? this.input.items,
			busy: this.pending !== null,
			disabled: !this.active || !!this.input.disabled || this.pending !== null,
		});
	}

	private publish(): void {
		const next = this.buildSnapshot();
		if (
			next.items === this.snapshot.items &&
			next.busy === this.snapshot.busy &&
			next.disabled === this.snapshot.disabled
		)
			return;
		this.snapshot = next;
		for (const listener of this.listeners) listener();
	}
}

function sameItems(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((id, index) => id === b[index]);
}
