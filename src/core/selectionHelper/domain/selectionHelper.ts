import type {
	SelectionCandidate,
	SelectionDictionaryAdapter,
	SelectionDictionarySource,
	SelectionHelperSettings,
	SelectionHelperSnapshot,
	SelectionLookupSession,
	SelectionSource,
	SelectionSourceLease,
	SelectionTarget,
	SelectionTranslationAdapter,
} from "./types";
import { orderSelectionDictionaries } from "./dictionaryOrder";

export interface SelectionHelperOptions {
	settings(): SelectionHelperSettings;
	dictionary: SelectionDictionaryAdapter;
	translation: SelectionTranslationAdapter;
}

interface SourceState {
	readonly owner: object;
	readonly reference: SelectionSource;
	active: boolean;
	revision: number;
}

/** Owns selection eligibility, popup state, query lifetime, and action ordering. */
export class SelectionHelper {
	private readonly listeners = new Set<() => void>();
	private snapshot: SelectionHelperSnapshot = EMPTY_SNAPSHOT;
	private lookupSession: SelectionLookupSession | null = null;
	private lookupUnsubscribe: (() => void) | null = null;
	private disposed = false;
	private readonly sources = new Map<SelectionSource, SourceState>();
	private interactionRevision = 0;

	constructor(private readonly options: SelectionHelperOptions) {}

	getSnapshot(): SelectionHelperSnapshot {
		return this.snapshot;
	}

	get openMainShortcut(): string {
		return this.options.settings().openMainShortcut;
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
			// A click may collapse the source selection without dismissing an open lookup.
			if (this.snapshot.mode !== "dictionary") this.clearSelection();
			return false;
		}
		const current = this.snapshot.target;
		if (
			this.snapshot.mode === "dictionary" &&
			current?.source === source &&
			current.text === text &&
			current.x === candidate.x &&
			current.y === candidate.y
		)
			return false;

		const sources = selectedSources(
			orderSelectionDictionaries(this.options.dictionary.sources(), settings.dictionaryOrder),
			settings.selectedDictionaries,
		);
		const isEnglishWord = isEnglishWordOrPhrase(text);
		const canLookup = isEnglishWord && sources.length > 0;
		const canTranslate = this.options.translation.available();
		if (!canLookup && !canTranslate) {
			this.clearSelection();
			return false;
		}

		this.releaseLookup();
		const target: SelectionTarget = {
			text,
			isEnglishWord,
			x: candidate.x,
			y: candidate.y,
			source,
			trigger: candidate.trigger,
		};
		this.publish({
			visible: true,
			mode: "actions",
			target,
			canLookup,
			canTranslate,
			lookup: null,
			session: null,
		});
		return true;
	}

	beginLookup(): void {
		if (this.disposed || !this.snapshot.target || !this.snapshot.canLookup) return;
		const settings = this.options.settings();
		const sourceIds = selectedSources(
			orderSelectionDictionaries(this.options.dictionary.sources(), settings.dictionaryOrder),
			settings.selectedDictionaries,
		).map((source) => source.id);
		if (sourceIds.length === 0) {
			this.dismiss();
			return;
		}
		this.releaseLookup();
		const session = this.options.dictionary.startLookup(this.snapshot.target.text, sourceIds);
		if (!session) {
			this.dismiss();
			return;
		}
		this.lookupSession = session;
		this.lookupUnsubscribe = session.subscribe(() => {
			if (this.lookupSession === session) this.publishLookup();
		});
		this.publish({
			...this.snapshot,
			mode: "dictionary",
			lookup: session.getSnapshot(),
			session,
		});
	}

	async translate(): Promise<void> {
		const text = this.snapshot.target?.text;
		if (!text || !this.snapshot.canTranslate) return;
		this.dismiss();
		await this.options.translation.openPrefilled(text);
	}

	get canFavorite(): boolean {
		return typeof this.options.dictionary.openFavorite === "function";
	}

	async openDictionaryInMainTab(): Promise<void> {
		const query = this.lookupSession?.getSnapshot().query ?? this.snapshot.target?.text;
		if (!query) return;
		this.dismiss();
		await this.options.dictionary.openInMainTab(query);
	}

	async openFavorite(word?: string): Promise<void> {
		const targetWord =
			word ?? this.lookupSession?.getSnapshot().query ?? this.snapshot.target?.text;
		if (!targetWord || !this.options.dictionary.openFavorite) return;
		this.dismiss();
		await this.options.dictionary.openFavorite(targetWord);
	}

	refresh(): void {
		if (!this.options.settings().enabled) this.dismiss();
	}

	dismiss(owner?: object): void {
		if (this.disposed) return;
		this.interrupt();
		if (owner === undefined || this.ownsSource(owner, this.snapshot.target?.source)) {
			this.clearSelection();
		}
	}

	private clearSelection(): void {
		this.releaseLookup();
		this.publish(EMPTY_SNAPSHOT);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.interrupt();
		for (const source of this.sources.values()) source.active = false;
		this.sources.clear();
		this.releaseLookup();
		this.snapshot = EMPTY_SNAPSHOT;
		for (const listener of this.listeners) listener();
		this.listeners.clear();
	}

	private publishLookup(): void {
		if (!this.lookupSession || !this.snapshot.visible) return;
		this.publish({ ...this.snapshot, lookup: this.lookupSession.getSnapshot() });
	}

	private releaseLookup(): void {
		this.lookupUnsubscribe?.();
		this.lookupUnsubscribe = null;
		this.lookupSession?.dispose();
		this.lookupSession = null;
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
	canLookup: false,
	canTranslate: false,
	lookup: null,
	session: null,
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

function selectedSources(
	sources: readonly SelectionDictionarySource[],
	selectedIds: readonly string[],
): readonly SelectionDictionarySource[] {
	if (selectedIds.length === 0) return sources;
	const selected = new Set(selectedIds);
	return sources.filter((source) => selected.has(source.id));
}

function isEnglishWordOrPhrase(text: string): boolean {
	const normalized = text.trim();
	if (!normalized || normalized.length > 80 || /[.!?;:\n]/u.test(normalized)) return false;
	const words = normalized.split(/\s+/u);
	return words.length <= 3 && words.every((word) => /^[A-Za-z][A-Za-z'-]*$/u.test(word));
}
