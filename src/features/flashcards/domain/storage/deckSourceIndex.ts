import { State } from "ts-fsrs";
import type { Card } from "ts-fsrs";
import type { Deck, DeckStats, FlashCard } from "../../../../core/shared/types";
import {
	DECK_INDEX_CACHE_VERSION,
	type DeckIndexCache,
	type DeckIndexCacheStore,
} from "../../../../core/storage/deckIndexCache";
import { CardCodec } from "./cardCodec";
import type { LearningStateDocument, SerializedDeck } from "./persistenceTypes";
import type { SessionWriteSet } from "./sessionCommitFormat";

export const LEARNING_PLACEHOLDER_DECK_ID = "__markdown-rebuild__";

export interface CardIndexLocation {
	readonly deckId: string;
	readonly cardIndex: number;
}

export interface DeckDueTimeChange {
	readonly deckId: string;
	readonly previous: Card;
	readonly next: Card;
}

export interface DeckSourceIndexOptions {
	readonly deckIndexCache?: DeckIndexCacheStore<SerializedDeck> | null;
}

/**
 * DeckSourceIndex - deep module owning Markdown-derived deck structures,
 * card identity locations, incremental due time calculation, and local cache
 * serialization.
 */
export class DeckSourceIndex {
	private decks: Map<string, Deck> = new Map();
	private cardIndex = new Map<string, CardIndexLocation>();
	private deckDueTimes = new Map<string, number[]>();
	private deckDueTimesValid = false;
	private deckStructureRevision = 0;
	private availableTags: string[] = [];
	private hasAvailableTagsSnapshotValue = false;
	private readonly deckIndexCache: DeckIndexCacheStore<SerializedDeck> | null;
	private readonly codec = new CardCodec();
	private cacheWriteTail: Promise<void> = Promise.resolve();
	private disposed = false;

	constructor(options: DeckSourceIndexOptions = {}) {
		this.deckIndexCache = options.deckIndexCache ?? null;
	}

	get hasCacheStore(): boolean {
		return this.deckIndexCache !== null;
	}

	getDecksMap(): ReadonlyMap<string, Deck> {
		return this.decks;
	}

	getAllDecks(): Deck[] {
		return Array.from(this.decks.values());
	}

	getDeck(id: string): Deck | undefined {
		return this.decks.get(id);
	}

	getAvailableTags(): string[] {
		return [...this.availableTags];
	}

	hasAvailableTagsSnapshot(): boolean {
		return this.hasAvailableTagsSnapshotValue;
	}

	getDeckStructureRevision(): number {
		return this.deckStructureRevision;
	}

	bumpDeckStructureRevision(): void {
		this.deckStructureRevision++;
	}

	getCard(deckId: string, cardId: string): FlashCard | undefined {
		const location = this.cardIndex.get(cardId);
		if (location) {
			const indexedDeck = this.decks.get(location.deckId);
			const indexedCard = indexedDeck?.cards[location.cardIndex];
			if (indexedCard && indexedCard.id === cardId) return indexedCard;
		}
		const deck = this.decks.get(deckId);
		const cardInOriginDeck = deck?.cards.find((card) => card.id === cardId);
		if (cardInOriginDeck) return cardInOriginDeck;
		for (const candidateDeck of this.decks.values()) {
			const card = candidateDeck.cards.find((candidate) => candidate.id === cardId);
			if (card) return card;
		}
		return undefined;
	}

	findCardLocation(
		deckId: string,
		cardId: string,
		decks: ReadonlyMap<string, Deck> = this.decks,
	): { deckId: string; deck: Deck; cardIndex: number } | null {
		if (decks === this.decks) {
			const location = this.cardIndex.get(cardId);
			if (location) {
				const candidateDeck = decks.get(location.deckId);
				const card = candidateDeck?.cards[location.cardIndex];
				if (card && card.id === cardId) {
					return {
						deckId: location.deckId,
						deck: candidateDeck!,
						cardIndex: location.cardIndex,
					};
				}
			}
		}
		const originDeck = decks.get(deckId);
		const originIndex = originDeck?.cards.findIndex((card) => card.id === cardId) ?? -1;
		if (originDeck && originIndex !== -1) {
			return { deckId, deck: originDeck, cardIndex: originIndex };
		}
		for (const [candidateDeckId, deck] of decks) {
			if (candidateDeckId === deckId) continue;
			const cardIndexInDeck = deck.cards.findIndex((card) => card.id === cardId);
			if (cardIndexInDeck !== -1) {
				return {
					deckId: candidateDeckId,
					deck,
					cardIndex: cardIndexInDeck,
				};
			}
		}
		return null;
	}

	getDeckStats(deck: Deck, now: Date = new Date()): DeckStats {
		let newCards = 0;
		let dueCards = 0;
		let learningCards = 0;
		let reviewCards = 0;
		let relearningCards = 0;

		for (const card of deck.cards) {
			switch (card.fsrsCard.state) {
				case State.New:
					newCards++;
					break;
				case State.Learning:
					learningCards++;
					if (card.fsrsCard.due <= now) dueCards++;
					break;
				case State.Review:
					reviewCards++;
					if (card.fsrsCard.due <= now) dueCards++;
					break;
				case State.Relearning:
					relearningCards++;
					if (card.fsrsCard.due <= now) dueCards++;
					break;
			}
		}

		return {
			totalCards: deck.cards.length,
			newCards,
			dueCards,
			learningCards,
			reviewCards,
			relearningCards,
		};
	}

	getNextDueTime(now: Date): number | null {
		if (!this.deckDueTimesValid) this.rebuildDeckDueTimes();
		const nowMs = now.getTime();
		let min = Infinity;
		for (const dueTimes of this.deckDueTimes.values()) {
			const due = findFirstDueAfter(dueTimes, nowMs);
			if (due !== null && due < min) min = due;
		}
		return min === Infinity ? null : min;
	}

	async loadCache(): Promise<DeckIndexCache<SerializedDeck> | null> {
		if (!this.deckIndexCache) return null;
		return this.deckIndexCache.load();
	}

	restoreFromCache(cache: DeckIndexCache<SerializedDeck>, learning: LearningStateDocument): void {
		this.decks = new Map();
		for (const [deckId, serializedDeck] of Object.entries(cache.decks)) {
			const deck = this.codec.decodeDeck(serializedDeck);
			const persistedDeck = learning.decks[deckId];
			if (persistedDeck) {
				deck.studyCount = persistedDeck.studyCount;
				deck.lastStudied = persistedDeck.lastStudied;
			}
			for (const card of deck.cards) {
				const persistedCard = learning.cards[card.id];
				if (persistedCard) {
					card.fsrsCard = this.codec.decodeFsrsCard(persistedCard.fsrsCard);
				}
			}
			this.decks.set(deckId, deck);
		}
		this.availableTags = [...cache.availableTags];
		this.hasAvailableTagsSnapshotValue = true;
	}

	restorePlaceholders(learning: LearningStateDocument): void {
		const placeholder = (deckId: string): Deck => ({
			id: deckId,
			name: deckId.split("/").pop()?.replace(/\.md$/i, "") ?? deckId,
			filePath: deckId,
			tag: "",
			cards: [],
			studyCount: learning.decks[deckId]?.studyCount ?? 0,
			lastStudied: learning.decks[deckId]?.lastStudied ?? null,
		});
		const decks = new Map(Object.keys(learning.decks).map((id) => [id, placeholder(id)]));
		for (const [cardId, state] of Object.entries(learning.cards)) {
			const deckId = state.sourceFile ?? LEARNING_PLACEHOLDER_DECK_ID;
			let deck = decks.get(deckId);
			if (!deck) {
				deck = placeholder(deckId);
				decks.set(deckId, deck);
			}
			deck.cards.push({
				id: cardId,
				front: "",
				back: "",
				fsrsCard: this.codec.decodeFsrsCard(state.fsrsCard),
				sourceFile: state.sourceFile ?? "",
				indexInFile: deck.cards.length,
			});
		}
		this.decks = decks;
	}

	restoreLegacyDecks(legacyDecks: Iterable<[string, Deck]>): void {
		this.decks = new Map(legacyDecks);
	}

	resetCodec(): void {
		this.codec.reset();
	}

	clear(): void {
		this.decks = new Map();
		this.availableTags = [];
		this.hasAvailableTagsSnapshotValue = false;
		this.codec.reset();
		this.cardIndex.clear();
		this.deckDueTimes.clear();
		this.deckDueTimesValid = false;
	}

	refreshDerivedState(): void {
		this.deckStructureRevision++;
		this.rebuildCardIndex();
		this.deckDueTimesValid = false;
	}

	installSynchronizedDecks(
		nextDecks: Map<string, Deck>,
		nextAvailableTags: string[],
		decksChanged: boolean,
	): void {
		this.decks = nextDecks;
		this.availableTags = nextAvailableTags;
		this.hasAvailableTagsSnapshotValue = true;
		if (decksChanged) this.refreshDerivedState();
	}

	setDecks(decks: Map<string, Deck>): void {
		this.decks = decks;
	}

	applyCardUpdates(
		cardUpdates: readonly { deckId: string; cardId: string; fsrsCard: Card }[],
	): void {
		if (cardUpdates.length === 0) return;
		const nextDecks = this.cloneDecksForTransition({
			cardUpdates,
			spellingAttempts: [],
			incrementStudyCountFor: [],
			historyEntries: [],
		});
		const dueTimeChanges: DeckDueTimeChange[] = [];
		for (const update of cardUpdates) {
			const location = this.findCardLocation(update.deckId, update.cardId, nextDecks);
			if (!location) continue;
			const previous = location.deck.cards[location.cardIndex]!;
			dueTimeChanges.push({
				deckId: location.deckId,
				previous: previous.fsrsCard,
				next: update.fsrsCard,
			});
			location.deck.cards[location.cardIndex] = {
				...previous,
				fsrsCard: update.fsrsCard,
			};
		}
		this.decks = nextDecks;
		this.applyDeckDueTimeChanges(dueTimeChanges);
	}

	cloneDecksForTransition(transition: SessionWriteSet): Map<string, Deck> {
		const touched = new Set<string>();
		for (const update of transition.cardUpdates) {
			const location = this.findCardLocation(update.deckId, update.cardId, this.decks);
			if (location) touched.add(location.deckId);
		}
		for (const deckId of transition.incrementStudyCountFor) touched.add(deckId);

		const next = new Map<string, Deck>();
		for (const [deckId, deck] of this.decks) {
			if (!touched.has(deckId)) {
				next.set(deckId, deck);
				continue;
			}
			next.set(deckId, {
				...deck,
				cards: [...deck.cards],
			});
		}
		return next;
	}

	refreshDeckDueTimes(deckId: string, decks: ReadonlyMap<string, Deck> = this.decks): void {
		if (!this.deckDueTimesValid) return;
		const deck = decks.get(deckId);
		if (!deck) {
			this.deckDueTimes.delete(deckId);
			return;
		}
		const dueTimes = collectDeckDueTimes(deck);
		if (dueTimes.length === 0) this.deckDueTimes.delete(deckId);
		else this.deckDueTimes.set(deckId, dueTimes);
	}

	scheduleCacheWrite(decks: ReadonlyMap<string, Deck>, availableTags: readonly string[]): void {
		this.cacheWriteTail = this.cacheWriteTail
			.then(() =>
				this.disposed ? undefined : this.writeDeckIndexCache(decks, availableTags),
			)
			.catch((error) => {
				console.warn("Failed to update the rebuildable deck-index cache:", error);
			});
	}

	private async writeDeckIndexCache(
		decks: ReadonlyMap<string, Deck>,
		availableTags: readonly string[],
	): Promise<void> {
		if (!this.deckIndexCache) return;
		const serializedDecks: Record<string, SerializedDeck> = {};
		for (const [id, deck] of decks) serializedDecks[id] = this.codec.deck(deck);
		await this.deckIndexCache.save({
			version: DECK_INDEX_CACHE_VERSION,
			updatedAt: new Date().toISOString(),
			availableTags: [...availableTags],
			decks: serializedDecks,
		});
	}

	private rebuildCardIndex(): void {
		this.cardIndex.clear();
		for (const [deckId, deck] of this.decks) {
			for (let index = 0; index < deck.cards.length; index++) {
				const card = deck.cards[index]!;
				if (!this.cardIndex.has(card.id)) {
					this.cardIndex.set(card.id, { deckId, cardIndex: index });
				}
			}
		}
	}

	private rebuildDeckDueTimes(decks: ReadonlyMap<string, Deck> = this.decks): void {
		this.deckDueTimes.clear();
		for (const [deckId, deck] of decks) {
			const dueTimes = collectDeckDueTimes(deck);
			if (dueTimes.length > 0) this.deckDueTimes.set(deckId, dueTimes);
		}
		this.deckDueTimesValid = true;
	}

	private applyDeckDueTimeChanges(changes: readonly DeckDueTimeChange[]): void {
		if (!this.deckDueTimesValid) return;
		for (const change of changes) {
			const previousDue =
				change.previous.state === State.New ? null : change.previous.due.getTime();
			const nextDue = change.next.state === State.New ? null : change.next.due.getTime();
			if (previousDue === nextDue) continue;
			const dueTimes = this.deckDueTimes.get(change.deckId) ?? [];
			if (previousDue !== null) removeSortedValue(dueTimes, previousDue);
			if (nextDue !== null) insertSortedValue(dueTimes, nextDue);
			if (dueTimes.length === 0) this.deckDueTimes.delete(change.deckId);
			else this.deckDueTimes.set(change.deckId, dueTimes);
		}
	}

	dispose(): void {
		this.disposed = true;
	}
}

function removeSortedValue(values: number[], value: number): void {
	const index = values.indexOf(value);
	if (index >= 0) values.splice(index, 1);
}

function insertSortedValue(values: number[], value: number): void {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		if (values[middle]! < value) low = middle + 1;
		else high = middle;
	}
	values.splice(low, 0, value);
}

function collectDeckDueTimes(deck: Deck): number[] {
	return deck.cards
		.filter((card) => card.fsrsCard.state !== State.New)
		.map((card) => card.fsrsCard.due.getTime())
		.sort((left, right) => left - right);
}

function findFirstDueAfter(sortedDueTimes: readonly number[], now: number): number | null {
	let low = 0;
	let high = sortedDueTimes.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		if (sortedDueTimes[middle]! <= now) low = middle + 1;
		else high = middle;
	}
	return sortedDueTimes[low] ?? null;
}
