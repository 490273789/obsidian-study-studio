import type {
	SelectionCandidate,
	SelectionDictionaryAdapter,
	SelectionDictionarySource,
	SelectionHelperSettings,
	SelectionHelperSnapshot,
	SelectionLookupSession,
	SelectionTarget,
	SelectionTranslationAdapter,
} from "./types";

export interface SelectionHelperOptions {
	settings(): SelectionHelperSettings;
	dictionary: SelectionDictionaryAdapter;
	translation: SelectionTranslationAdapter;
}

/** Owns selection eligibility, popup state, query lifetime, and action ordering. */
export class SelectionHelper {
	private readonly listeners = new Set<() => void>();
	private snapshot: SelectionHelperSnapshot = EMPTY_SNAPSHOT;
	private lookupSession: SelectionLookupSession | null = null;
	private lookupUnsubscribe: (() => void) | null = null;
	private disposed = false;

	constructor(private readonly options: SelectionHelperOptions) {}

	getSnapshot(): SelectionHelperSnapshot {
		return this.snapshot;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	handleSelection(candidate: SelectionCandidate): void {
		if (this.disposed) return;
		const settings = this.options.settings();
		if (
			!settings.enabled ||
			!candidate.eligibleContext ||
			!modifierMatches(settings, candidate)
		) {
			return;
		}
		const text = candidate.text.trim();
		if (!text) {
			this.dismiss();
			return;
		}

		const sources = selectedSources(
			this.options.dictionary.sources(),
			settings.selectedDictionaries,
		);
		const isEnglishWord = isEnglishWordOrPhrase(text);
		const canLookup = isEnglishWord && sources.length > 0;
		const canTranslate = this.options.translation.available();
		if (!canLookup && !canTranslate) {
			this.dismiss();
			return;
		}

		this.releaseLookup();
		const target: SelectionTarget = { text, isEnglishWord, x: candidate.x, y: candidate.y };
		this.publish({
			visible: true,
			mode: "actions",
			target,
			canLookup,
			canTranslate,
			lookup: null,
		});
	}

	beginLookup(): void {
		if (this.disposed || !this.snapshot.target || !this.snapshot.canLookup) return;
		const sourceIds = selectedSources(
			this.options.dictionary.sources(),
			this.options.settings().selectedDictionaries,
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
		this.lookupUnsubscribe = session.subscribe(() => this.publishLookup());
		this.publish({ ...this.snapshot, mode: "dictionary", lookup: session.getSnapshot() });
	}

	selectSource(sourceId: string): void {
		this.lookupSession?.selectSource(sourceId);
	}

	selectSection(sourceId: string, sectionIndex: number): void {
		this.lookupSession?.selectSection(sourceId, sectionIndex);
	}

	async lookup(word: string): Promise<void> {
		if (this.disposed || !this.snapshot.visible) return;
		await this.lookupSession?.lookup(word);
	}

	async retry(sourceId: string): Promise<void> {
		await this.lookupSession?.retry(sourceId);
	}

	async generateAi(): Promise<void> {
		await this.lookupSession?.generateAi();
	}

	async translate(): Promise<void> {
		const text = this.snapshot.target?.text;
		if (!text || !this.snapshot.canTranslate) return;
		this.dismiss();
		await this.options.translation.openPrefilled(text);
	}

	async openDictionaryInMainTab(): Promise<void> {
		const query = this.lookupSession?.getSnapshot().query ?? this.snapshot.target?.text;
		if (!query) return;
		this.dismiss();
		await this.options.dictionary.openInMainTab(query);
	}

	refresh(): void {
		if (!this.options.settings().enabled) this.dismiss();
	}

	dismiss(): void {
		this.releaseLookup();
		this.publish(EMPTY_SNAPSHOT);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
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
});

function modifierMatches(
	settings: SelectionHelperSettings,
	candidate: SelectionCandidate,
): boolean {
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
