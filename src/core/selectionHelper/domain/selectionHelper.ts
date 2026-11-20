import type {
	SelectionAction,
	SelectionActionContext,
	SelectionCandidate,
	SelectionHelperSettings,
	SelectionHelperSnapshot,
	SelectionSource,
	SelectionSourceLease,
	SelectionTarget,
} from "./types";

export interface SelectionHelperOptions {
	settings(): SelectionHelperSettings;
	actions?: readonly SelectionAction[];
}

interface SourceState {
	readonly owner: object;
	readonly reference: SelectionSource;
	active: boolean;
	revision: number;
}

/** Owns selection eligibility, popup state, and action dispatching. */
export class SelectionHelper {
	private readonly listeners = new Set<() => void>();
	private snapshot: SelectionHelperSnapshot = EMPTY_SNAPSHOT;
	private disposed = false;
	private readonly sources = new Map<SelectionSource, SourceState>();
	private interactionRevision = 0;
	private explicitlyOpened = false;
	private readonly actions: readonly SelectionAction[];

	constructor(private readonly options: SelectionHelperOptions) {
		this.actions = options.actions ?? [];
	}

	getSnapshot(): SelectionHelperSnapshot {
		return this.snapshot;
	}

	get openMainShortcut(): string {
		return this.options.settings().openMainShortcut;
	}

	get selectedDictionaries(): readonly string[] {
		return this.options.settings().selectedDictionaries ?? [];
	}

	get dictionaryOrder(): readonly string[] {
		return this.options.settings().dictionaryOrder ?? [];
	}

	get registeredActions(): readonly SelectionAction[] {
		return this.actions;
	}

	get eligibleActions(): readonly SelectionAction[] {
		const eligibleIds = new Set(this.snapshot.eligibleActionIds);
		return this.actions.filter((action) => eligibleIds.has(action.id));
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** One source lease per document or web page, shared by all its captures. */
	openSource(owner: object): SelectionSourceLease {
		const reference: SelectionSource = Object.freeze({
			id: `selection-${crypto.randomUUID()}`,
		});
		const state: SourceState = { owner, reference, active: !this.disposed, revision: 0 };
		if (state.active) this.sources.set(reference, state);
		const lease: SelectionSourceLease = {
			reference,
			get active() {
				return state.active;
			},
			capture: () => {
				const interaction = this.interactionRevision;
				const revision = state.revision;
				let consumed = false;
				const isCurrent = () =>
					state.active &&
					!consumed &&
					interaction === this.interactionRevision &&
					revision === state.revision;
				return {
					isCurrent,
					submit: (candidate) => {
						if (!isCurrent()) return false;
						consumed = true;
						this.interrupt();
						return this.acceptSelection(candidate, reference);
					},
					dismiss: () => {
						if (!isCurrent()) return;
						consumed = true;
						lease.dismiss();
					},
				};
			},
			dismiss: () => {
				if (!state.active) return;
				state.revision++;
				if (this.snapshot.target?.source === reference) this.clearSelection();
			},
			dispose: () => {
				if (!state.active) return;
				state.active = false;
				this.sources.delete(reference);
				if (this.snapshot.target?.source === reference) this.clearSelection();
			},
		};
		return lease;
	}

	ownsSource(owner: object, source: SelectionSource | undefined): boolean {
		return source !== undefined && this.sources.get(source)?.owner === owner;
	}

	/** Fence pending captures across windows without closing the current query. */
	interrupt(): void {
		this.interactionRevision++;
	}

	private buildActionContext(input: {
		text: string;
		x: number;
		y: number;
		trigger?: SelectionActionContext["trigger"];
	}): SelectionActionContext {
		return {
			text: input.text,
			x: input.x,
			y: input.y,
			trigger: input.trigger,
			selectedDictionaries: this.selectedDictionaries,
		};
	}

	private acceptSelection(candidate: SelectionCandidate, source: SelectionSource): boolean {
		const settings = this.options.settings();
		if (
			!settings.enabled ||
			!candidate.eligibleContext ||
			!modifierMatches(settings, candidate)
		) {
			return false;
		}
		const text = candidate.text.trim();
		if (!text) {
			// A click may collapse the source selection without dismissing an open slot.
			if (this.snapshot.mode !== "slot") {
				this.clearSelection();
			}
			return false;
		}
		const current = this.snapshot.target;
		if (
			this.snapshot.mode === "slot" &&
			current?.source === source &&
			current.text === text &&
			current.x === candidate.x &&
			current.y === candidate.y
		) {
			return false;
		}

		const actionContext = this.buildActionContext({
			text,
			x: candidate.x,
			y: candidate.y,
			trigger: candidate.trigger,
		});
		const eligible = this.actions.filter((a) => a.isEligible(actionContext));
		if (eligible.length === 0) {
			this.clearSelection();
			return false;
		}

		this.explicitlyOpened = false;
		const target: SelectionTarget = {
			text,
			isEnglishWord: isEnglishWordOrPhrase(text),
			x: candidate.x,
			y: candidate.y,
			source,
			trigger: candidate.trigger,
		};
		this.publish({
			visible: true,
			mode: "actions",
			target,
			activeSlotId: null,
			eligibleActionIds: eligible.map((a) => a.id),
		});
		return true;
	}

	/** Trigger an action by ID. If the action specifies a slotId, transitions into slot mode. */
	async triggerAction(actionId: string): Promise<void> {
		if (this.disposed || !this.snapshot.target) return;
		const target = this.snapshot.target;
		const action = this.actions.find((a) => a.id === actionId);
		if (!action) return;

		const context = this.buildActionContext(target);
		if (!action.isEligible(context)) return;

		if (action.slotId) {
			this.publish({
				...this.snapshot,
				mode: "slot",
				activeSlotId: action.slotId,
			});
		} else {
			this.dismiss();
			await action.execute(context);
		}
	}

	/** Explicit user action; opens a specific slot independently of automatic selection preferences. */
	openSlot(
		slotId: string,
		source: SelectionSource,
		candidate?: { text: string; x: number; y: number },
	): void {
		const owner = this.sources.get(source)?.owner;
		if (this.disposed || !owner) return;
		this.interrupt();
		const text = candidate?.text.trim() ?? "";
		const valid = slotId === "dictionary" ? isEnglishWordOrPhrase(text) : Boolean(text);
		const current = this.snapshot;
		if (
			current.visible &&
			current.mode === "slot" &&
			current.activeSlotId === slotId &&
			(!valid
				? this.ownsSource(owner, current.target?.source)
				: current.target?.source === source && current.target.text === text)
		) {
			this.explicitlyOpened = true;
			return;
		}
		this.explicitlyOpened = true;
		const target: SelectionTarget = {
			source,
			text: valid ? text : "",
			isEnglishWord: isEnglishWordOrPhrase(text),
			x: valid && candidate ? candidate.x : 0,
			y: valid && candidate ? candidate.y : 0,
			trigger: valid && candidate ? undefined : "manual",
		};
		const actionContext = this.buildActionContext({
			text,
			x: target.x,
			y: target.y,
			trigger: target.trigger,
		});
		const eligible = this.actions.filter((a) => a.isEligible(actionContext));
		this.publish({
			visible: true,
			mode: "slot",
			activeSlotId: slotId,
			target,
			eligibleActionIds: eligible.map((a) => a.id),
		});
	}

	refresh(): void {
		if (!this.options.settings().enabled && !this.explicitlyOpened) this.dismiss();
	}

	dismiss(owner?: object): void {
		if (this.disposed) return;
		this.interrupt();
		if (owner === undefined || this.ownsSource(owner, this.snapshot.target?.source)) {
			this.clearSelection();
		}
	}

	private clearSelection(): void {
		this.explicitlyOpened = false;
		this.publish(EMPTY_SNAPSHOT);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.interrupt();
		for (const source of this.sources.values()) source.active = false;
		this.sources.clear();
		this.snapshot = EMPTY_SNAPSHOT;
		for (const listener of this.listeners) listener();
		this.listeners.clear();
	}

	private publish(snapshot: SelectionHelperSnapshot): void {
		this.snapshot = snapshot;
		for (const listener of this.listeners) listener();
	}
}

const EMPTY_SNAPSHOT: SelectionHelperSnapshot = Object.freeze({
	visible: false,
	mode: "actions",
	target: null,
	activeSlotId: null,
	eligibleActionIds: [],
});

function modifierMatches(
	settings: SelectionHelperSettings,
	candidate: SelectionCandidate,
): boolean {
	if (candidate.trigger === "touch") return true;
	switch (settings.modifier) {
		case "alt":
			return candidate.altKey;
		case "shift":
			return candidate.shiftKey;
		case "ctrl":
			return candidate.ctrlOrMetaKey;
		default:
			return true;
	}
}

export function isEnglishWordOrPhrase(text: string): boolean {
	const normalized = text.trim();
	if (!normalized || normalized.length > 80 || /[.!?;:\n]/u.test(normalized)) return false;
	const words = normalized.split(/\s+/u);
	return words.length <= 3 && words.every((word) => /^[A-Za-z][A-Za-z'-]*$/u.test(word));
}
