import { hasFlashcardSyntax } from "../cards/cardFormat";
import { createEmptyCard } from "ts-fsrs";
import {
	editDeckSource,
	registerMissingCardIdentities,
	rewriteCardIdentityMarkers,
	DeckSourceEditException,
	type DeckSourceEditError,
	type DeckSourceEditResult,
} from "../cards/deckSourceEditor";
import { extractFirstTag, parseFlashcards } from "../cards/parser";
import { extractSpellingWord } from "../cards/spellingWord";
import type { Deck, FlashCard } from "../../../../core/shared/types";

export interface ContinuitySourceDocument {
	path: string;
	basename: string;
	content: string;
	/** Cached content used only to discover tags; never authoritative for source changes. */
	discoveryOnly?: boolean;
}

export interface ContinuitySourceStore {
	/**
	 * Lists authoritative source documents plus optional discovery-only cached
	 * documents. Adapters may use `configuredTags` to avoid live reads for files
	 * that cannot belong to the current deck index.
	 */
	list(configuredTags?: string[]): Promise<ContinuitySourceDocument[]>;
	replaceIfUnchanged(
		path: string,
		expectedContent: string,
		nextContent: string,
	): Promise<"written" | "stale">;
}

export type ContinuitySourceCondition =
	| { type: "current" }
	| { type: "legacy"; cardCount: number }
	| {
			type: "last-known-good";
			reason: "identity-conflict" | "identity-ambiguity" | "source-failure";
	  };

export type CardIdentityIssue =
	| {
			id: string;
			ticket: string;
			type: "identity-conflict";
			identity: string;
			affectedSources: string[];
			candidates: CardIdentityCandidate[];
	  }
	| {
			id: string;
			ticket: string;
			type: "identity-ambiguity";
			missingIdentities: string[];
			affectedSources: string[];
			candidates: CardIdentityCandidate[];
	  };

export interface CardIdentityCandidate {
	token: string;
	sourcePath: string;
	front: string;
	back: string;
}

export interface ContinuityJournal {
	id: string;
	type: "migration" | "repair";
	issueId?: string;
	completedSources: string[];
	pendingSources: string[];
	sources: ContinuityJournalSource[];
}

export interface ContinuityJournalSource {
	path: string;
	expectedContent: string;
	nextContent: string;
	identityMap: Record<string, string>;
}

export interface PersistedCardIdentityContinuityState {
	sources: Record<string, ContinuitySourceCondition>;
	issues: CardIdentityIssue[];
	journal: ContinuityJournal | null;
}

export interface CardIdentityContinuityState {
	configuredTags: string[];
	availableTags?: string[];
	decks: Map<string, Deck>;
	continuity: PersistedCardIdentityContinuityState;
}

export interface ContinuityStateStore {
	load(): Promise<CardIdentityContinuityState>;
	commit(state: CardIdentityContinuityState): Promise<void>;
}

export interface ContinuitySessionChange {
	availableIdentities: Set<string>;
	deletedIdentities: Set<string>;
	spellableIdentitiesByDeck?: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface ContinuitySessionAdapter {
	hasActiveSession(): boolean;
	reconcile(change: ContinuitySessionChange): Promise<void>;
}

export interface CardIdentityContinuitySnapshot {
	sources: Record<string, ContinuitySourceCondition>;
	issues: CardIdentityIssue[];
	journal: ContinuityJournal | null;
	migration?: MigrationPreview;
}

export interface MigrationPreview {
	ticket: string;
	sourceCount: number;
	cardCount: number;
	sources: Array<{ deckId: string; deckName: string; cardCount: number }>;
}

export type SynchronizeOutcome =
	| { kind: "current"; changedDeckIds: string[] }
	| {
			kind: "attention-required";
			changedDeckIds: string[];
			issueIds: string[];
	  }
	| { kind: "failed"; retryable: boolean; message: string };

export type ContinuityResolution =
	| {
			kind: "migrate";
			ticket: string;
			deckIds: string[];
	  }
	| {
			kind: "repair";
			ticket: string;
			issueId: string;
			successors: Array<{
				cardIdentity: string;
				occurrence: string | null;
			}>;
	  };

export type ResolutionOutcome =
	| { kind: "applied" }
	| {
			kind: "resumable";
			completedDeckIds: string[];
			pendingDeckIds: string[];
	  }
	| {
			kind: "blocked";
			reason:
				| "active-session"
				| "preview-expired"
				| "source-changing"
				| "legacy-source-mismatch";
	  }
	| { kind: "failed"; retryable: boolean; message: string };

export interface CardContentChange {
	front: string;
	back: string;
	explanation?: string;
}

export type CardValidationError = DeckSourceEditError;

export type PluginCardChange =
	| { kind: "add"; deckId: string; content: CardContentChange }
	| { kind: "edit"; cardIdentity: string; content: CardContentChange; deckId?: string }
	| { kind: "delete"; cardIdentity: string; deckId?: string };

export type CardChangeOutcome =
	| { kind: "applied"; cardIdentity?: string }
	| {
			kind: "blocked";
			reason: "source-needs-repair" | "migration-required";
			issueId?: string;
	  }
	| { kind: "validation-failed"; error: CardValidationError }
	| { kind: "source-changing"; deckId: string }
	| { kind: "failed"; retryable: boolean; message: string };

export type CardEditPreparation =
	| { readonly kind: "ready"; readonly card: FlashCard }
	| {
			readonly kind: "blocked";
			readonly reason: "source-needs-repair" | "migration-required";
			readonly issueId?: string;
	  }
	| { readonly kind: "not-found" };

export interface CardIdentityContinuity {
	synchronize(): Promise<SynchronizeOutcome>;
	prepareEdit(deckId: string, cardId: string): Promise<CardEditPreparation>;
	change(change: PluginCardChange): Promise<CardChangeOutcome>;
	inspect(): CardIdentityContinuitySnapshot;
	resolve(resolution: ContinuityResolution): Promise<ResolutionOutcome>;
}

export interface CreateCardIdentityContinuityOptions {
	sources: ContinuitySourceStore;
	state: ContinuityStateStore;
	sessions?: ContinuitySessionAdapter;
	createIdentity: () => string;
}

interface PreparedSource {
	document: ContinuitySourceDocument;
	tag: string;
	cards: FlashCard[];
	existingDeck: Deck | undefined;
	sourceContent: string;
}

interface CachedSourceSyntax {
	content: string;
	tag: string | null;
	hasCards: boolean;
	cards?: Omit<FlashCard, "fsrsCard">[];
	bytes: number;
}

const SOURCE_SYNTAX_CACHE_BYTES = 32 * 1_048_576;
const SOURCE_SYNTAX_CACHE_ENTRIES = 2048;

export function createCardIdentityContinuity(
	options: CreateCardIdentityContinuityOptions,
): CardIdentityContinuity {
	return new DefaultCardIdentityContinuity(options);
}

class DefaultCardIdentityContinuity implements CardIdentityContinuity {
	private snapshot: CardIdentityContinuitySnapshot = {
		sources: {},
		issues: [],
		journal: null,
	};
	private operationTail: Promise<void> = Promise.resolve();
	// Only source-derived syntax is reusable. Learning state always comes from
	// the state loaded for this operation, including after external Sync reloads.
	private readonly sourceSyntax = new Map<string, CachedSourceSyntax>();
	private sourceSyntaxBytes = 0;

	constructor(private readonly options: CreateCardIdentityContinuityOptions) {}

	synchronize(): Promise<SynchronizeOutcome> {
		return this.enqueue(() => this.synchronizeNow());
	}

	private async synchronizeNow(): Promise<SynchronizeOutcome> {
		try {
			let currentState = await this.options.state.load();
			let documents = await this.options.sources.list(currentState.configuredTags);
			if (currentState.continuity.journal) {
				const recovery = await this.executeJournal(documents, currentState);
				if (recovery.kind !== "applied") {
					return {
						kind: "failed",
						retryable: recovery.kind === "resumable" || recovery.kind === "failed",
						message:
							recovery.kind === "failed"
								? recovery.message
								: "Card identity journal is waiting for the source to stop changing",
					};
				}
				currentState = await this.options.state.load();
				documents = await this.options.sources.list(currentState.configuredTags);
			}
			const configuredTags = new Set(
				currentState.configuredTags.map((tag) => tag.toLowerCase()),
			);
			const sourcePaths = new Set(documents.map((document) => document.path));
			for (const [path, cached] of this.sourceSyntax) {
				if (!sourcePaths.has(path)) {
					this.sourceSyntax.delete(path);
					this.sourceSyntaxBytes -= cached.bytes;
				}
			}
			const existingCards = buildExistingCardMap(currentState.decks);
			const nextDecks = new Map<string, Deck>();
			const nextSources: Record<string, ContinuitySourceCondition> = {};
			const preparedSources: PreparedSource[] = [];
			const availableTags = new Set<string>();
			let attentionRequired = false;

			for (const document of documents) {
				const { tag, hasCards } = this.inspectSource(document.path, document.content);
				if (tag && hasCards) availableTags.add(tag);
				if (document.discoveryOnly) continue;
				if (!tag || !configuredTags.has(tag.toLowerCase()) || !hasCards) {
					continue;
				}

				let sourceContent = document.content;
				const existingDeck = currentState.decks.get(document.path);
				if (
					existingDeck &&
					existingDeck.cards.some((card) => isLegacyIdentity(document.path, card.id))
				) {
					nextDecks.set(document.path, existingDeck);
					nextSources[document.path] = {
						type: "legacy",
						cardCount: existingDeck.cards.length,
					};
					attentionRequired = true;
					continue;
				}
				if (!existingDeck) {
					const registration = registerMissingCardIdentities(
						sourceContent,
						this.options.createIdentity,
					);
					if (registration.registeredIdentities.length > 0) {
						const writeResult = await this.options.sources.replaceIfUnchanged(
							document.path,
							document.content,
							registration.nextContent,
						);
						if (writeResult === "stale") {
							return {
								kind: "failed",
								retryable: true,
								message: `Source changed before identity registration: ${document.path}`,
							};
						}
						sourceContent = registration.nextContent;
					}
				}

				const cards = this.parseSource(sourceContent, document.path, existingCards);
				if (cards.length === 0) continue;
				preparedSources.push({
					document,
					tag,
					cards,
					existingDeck,
					sourceContent,
				});
			}

			const currentStableIdentities = new Set(
				preparedSources.flatMap((source) =>
					source.cards
						.filter((card) => !isLegacyIdentity(source.document.path, card.id))
						.map((card) => card.id),
				),
			);
			const ambiguities: CardIdentityIssue[] = [];
			for (const source of preparedSources) {
				if (!source.existingDeck) continue;
				const hasUnmarkedCard = source.cards.some((card) =>
					isLegacyIdentity(source.document.path, card.id),
				);
				if (!hasUnmarkedCard) continue;

				const missingIdentities = source.existingDeck.cards
					.map((card) => card.id)
					.filter((identity) => !currentStableIdentities.has(identity));
				if (missingIdentities.length > 0) {
					const candidates = source.cards
						.filter((card) => isLegacyIdentity(source.document.path, card.id))
						.map((card, index) => makeCandidate(source, card, index));
					ambiguities.push({
						id: `identity-ambiguity:${source.document.path}`,
						ticket: buildIssueTicket("identity-ambiguity", [source]),
						type: "identity-ambiguity",
						missingIdentities,
						affectedSources: [source.document.path],
						candidates,
					});
					continue;
				}

				const registration = registerMissingCardIdentities(
					source.sourceContent,
					this.options.createIdentity,
				);
				const writeResult = await this.options.sources.replaceIfUnchanged(
					source.document.path,
					source.document.content,
					registration.nextContent,
				);
				if (writeResult === "stale") {
					return {
						kind: "failed",
						retryable: true,
						message: `Source changed before identity registration: ${source.document.path}`,
					};
				}
				source.sourceContent = registration.nextContent;
				source.cards = this.parseSource(
					registration.nextContent,
					source.document.path,
					existingCards,
				);
			}

			const conflicts = findIdentityConflicts(preparedSources);
			const conflictPaths = new Set(
				conflicts.flatMap((conflict) => conflict.affectedSources),
			);
			const ambiguityPaths = new Set(
				ambiguities.flatMap((ambiguity) => ambiguity.affectedSources),
			);
			if (conflicts.length > 0 || ambiguities.length > 0) attentionRequired = true;

			for (const source of preparedSources) {
				if (
					conflictPaths.has(source.document.path) ||
					ambiguityPaths.has(source.document.path)
				) {
					if (source.existingDeck) {
						nextDecks.set(source.document.path, source.existingDeck);
					}
					nextSources[source.document.path] = {
						type: "last-known-good",
						reason: ambiguityPaths.has(source.document.path)
							? "identity-ambiguity"
							: "identity-conflict",
					};
					continue;
				}

				nextDecks.set(source.document.path, {
					id: source.document.path,
					name: source.document.basename,
					filePath: source.document.path,
					tag: source.tag,
					cards: source.cards,
					studyCount: source.existingDeck?.studyCount ?? 0,
					lastStudied: source.existingDeck?.lastStudied ?? null,
				});
				nextSources[source.document.path] = { type: "current" };
			}

			const nextContinuity: PersistedCardIdentityContinuityState = {
				sources: nextSources,
				issues: [...conflicts, ...ambiguities],
				journal: currentState.continuity.journal,
			};
			await this.options.state.commit({
				...currentState,
				availableTags: Array.from(availableTags),
				decks: nextDecks,
				continuity: nextContinuity,
			});
			await this.reconcileSessions(currentState.decks, nextDecks);
			this.snapshot = cloneSnapshot(
				nextContinuity,
				buildMigrationPreview(documents, nextDecks, nextSources),
			);

			return attentionRequired
				? {
						kind: "attention-required",
						changedDeckIds: Array.from(nextDecks.keys()),
						issueIds: [...conflicts, ...ambiguities].map((issue) => issue.id),
					}
				: {
						kind: "current",
						changedDeckIds: Array.from(nextDecks.keys()),
					};
		} catch (error) {
			return {
				kind: "failed",
				retryable: true,
				message: error instanceof Error ? error.message : "Card identity sync failed",
			};
		}
	}

	private inspectSource(path: string, content: string): CachedSourceSyntax {
		const cached = this.sourceSyntax.get(path);
		if (cached?.content === content) {
			return cached;
		}
		const next: CachedSourceSyntax = {
			content,
			tag: extractFirstTag(content),
			hasCards: hasFlashcardSyntax(content),
			bytes: 2 * (path.length + content.length),
		};
		this.cacheSource(path, next);
		return next;
	}

	private parseSource(
		content: string,
		path: string,
		existingCards: Map<string, FlashCard>,
	): FlashCard[] {
		const syntax = this.inspectSource(path, content);
		if (syntax.cards) {
			return syntax.cards.map((card) => ({
				...card,
				fsrsCard: existingCards.get(card.id)?.fsrsCard ?? createEmptyCard(),
			}));
		}
		const cards = parseFlashcards(content, path, existingCards);
		// Never retain FSRS objects in the cache, even for a failed commit or a
		// source that currently requires identity repair.
		const templates = cards.map((card) => ({
			id: card.id,
			front: card.front,
			back: card.back,
			explanation: card.explanation,
			sourceFile: card.sourceFile,
			indexInFile: card.indexInFile,
		}));
		this.cacheSource(path, {
			...syntax,
			cards: templates,
			// Bound retained strings plus an allowance for each template object.
			bytes:
				syntax.bytes +
				templates.reduce(
					(bytes, card) =>
						bytes +
						128 +
						2 *
							(card.id.length +
								card.front.length +
								card.back.length +
								(card.explanation?.length ?? 0) +
								card.sourceFile.length),
					0,
				),
		});
		return cards;
	}

	private cacheSource(path: string, syntax: CachedSourceSyntax): void {
		const previous = this.sourceSyntax.get(path);
		if (previous) this.sourceSyntaxBytes -= previous.bytes;
		this.sourceSyntax.delete(path);
		// Full scans revisit sources in order. Reject excess admissions instead
		// of evicting useful entries and thrashing the entire cache every scan.
		if (
			this.sourceSyntaxBytes + syntax.bytes > SOURCE_SYNTAX_CACHE_BYTES ||
			this.sourceSyntax.size >= SOURCE_SYNTAX_CACHE_ENTRIES
		)
			return;
		this.sourceSyntax.set(path, syntax);
		this.sourceSyntaxBytes += syntax.bytes;
	}

	prepareEdit(deckId: string, cardId: string): Promise<CardEditPreparation> {
		return this.enqueue(() => this.prepareEditNow(deckId, cardId));
	}

	private async prepareEditNow(deckId: string, cardId: string): Promise<CardEditPreparation> {
		const currentState = await this.options.state.load();
		const deck =
			currentState.decks.get(deckId) ??
			Array.from(currentState.decks.values()).find((candidate) =>
				candidate.cards.some(
					(card) =>
						card.id === cardId ||
						(Number.isInteger(Number(cardId)) && card.indexInFile === Number(cardId)),
				),
			);
		if (!deck) {
			return { kind: "not-found" };
		}

		const condition = currentState.continuity.sources[deck.filePath];
		if (condition?.type === "legacy") {
			return { kind: "blocked", reason: "migration-required" };
		}
		if (condition?.type === "last-known-good") {
			const issue = currentState.continuity.issues.find((candidate) =>
				candidate.affectedSources.includes(deck.filePath),
			);
			return {
				kind: "blocked",
				reason: "source-needs-repair",
				issueId: issue?.id,
			};
		}

		const card =
			deck.cards.find((candidate) => candidate.id === cardId) ??
			(Number.isInteger(Number(cardId)) ? deck.cards[Number(cardId)] : undefined);
		if (!card) {
			return { kind: "not-found" };
		}

		return { kind: "ready", card };
	}

	change(change: PluginCardChange): Promise<CardChangeOutcome> {
		return this.enqueue(() => this.changeNow(change));
	}

	private async changeNow(change: PluginCardChange): Promise<CardChangeOutcome> {
		try {
			let currentState = await this.options.state.load();
			let documents = await this.options.sources.list(currentState.configuredTags);
			if (currentState.continuity.journal) {
				const recovery = await this.executeJournal(documents, currentState);
				if (recovery.kind !== "applied") {
					return {
						kind: "failed",
						retryable: true,
						message: "An unfinished card identity operation is waiting to resume",
					};
				}
				currentState = await this.options.state.load();
				documents = await this.options.sources.list(currentState.configuredTags);
			}
			const deck =
				change.kind === "add"
					? currentState.decks.get(change.deckId)
					: ((change.deckId ? currentState.decks.get(change.deckId) : undefined) ??
						Array.from(currentState.decks.values()).find((candidate) =>
							candidate.cards.some(
								(card) =>
									card.id === change.cardIdentity ||
									(Number.isInteger(Number(change.cardIdentity)) &&
										card.indexInFile === Number(change.cardIdentity)),
							),
						));
			if (!deck) {
				return {
					kind: "failed",
					retryable: false,
					message: "Deck or card not found",
				};
			}

			const condition = currentState.continuity.sources[deck.filePath];
			if (condition?.type === "legacy") {
				return { kind: "blocked", reason: "migration-required" };
			}
			if (condition?.type === "last-known-good") {
				const issue = currentState.continuity.issues.find((candidate) =>
					candidate.affectedSources.includes(deck.filePath),
				);
				return {
					kind: "blocked",
					reason: "source-needs-repair",
					issueId: issue?.id,
				};
			}

			const document = documents.find((candidate) => candidate.path === deck.filePath);
			if (!document) {
				return {
					kind: "failed",
					retryable: false,
					message: "Source file not found",
				};
			}
			const newIdentity = change.kind === "add" ? this.options.createIdentity() : undefined;
			let editResult: DeckSourceEditResult;
			try {
				if (change.kind === "add") {
					editResult = editDeckSource(document.content, deck, {
						type: "add",
						cardId: newIdentity,
						...change.content,
					});
				} else {
					const targetCardIdentity =
						(
							deck.cards.find((c) => c.id === change.cardIdentity) ??
							(Number.isInteger(Number(change.cardIdentity))
								? deck.cards[Number(change.cardIdentity)]
								: undefined)
						)?.id ?? change.cardIdentity;
					editResult = editDeckSource(
						document.content,
						deck,
						change.kind === "edit"
							? {
									type: "update",
									cardId: targetCardIdentity,
									...change.content,
								}
							: { type: "delete", cardId: targetCardIdentity },
					);
				}
			} catch (error) {
				if (error instanceof DeckSourceEditException) {
					return { kind: "validation-failed", error: error.editError };
				}
				throw error;
			}
			const writeResult = await this.options.sources.replaceIfUnchanged(
				deck.filePath,
				document.content,
				editResult.nextContent,
			);
			if (writeResult === "stale") {
				return { kind: "source-changing", deckId: deck.id };
			}

			const syncOutcome = await this.synchronizeNow();
			if (syncOutcome.kind === "failed") return syncOutcome;
			return newIdentity
				? { kind: "applied", cardIdentity: newIdentity }
				: { kind: "applied" };
		} catch (error) {
			return {
				kind: "failed",
				retryable: false,
				message: error instanceof Error ? error.message : "Card source change failed",
			};
		}
	}

	resolve(resolution: ContinuityResolution): Promise<ResolutionOutcome> {
		return this.enqueue(() => this.resolveNow(resolution));
	}

	private async resolveNow(resolution: ContinuityResolution): Promise<ResolutionOutcome> {
		if (resolution.kind === "repair") return this.resolveRepair(resolution);

		try {
			let currentState = await this.options.state.load();
			let documents = await this.options.sources.list(currentState.configuredTags);
			if (currentState.continuity.journal) {
				const recovery = await this.executeJournal(documents, currentState);
				if (recovery.kind !== "applied") return recovery;
				currentState = await this.options.state.load();
				documents = await this.options.sources.list(currentState.configuredTags);
			}
			if (this.options.sessions?.hasActiveSession()) {
				return { kind: "blocked", reason: "active-session" };
			}
			const preview = buildMigrationPreview(
				documents,
				currentState.decks,
				currentState.continuity.sources,
			);
			if (!preview || preview.ticket !== resolution.ticket) {
				return { kind: "blocked", reason: "preview-expired" };
			}

			const selected = new Set(resolution.deckIds);
			const plans: ContinuityJournalSource[] = [];
			for (const source of preview.sources) {
				if (!selected.has(source.deckId)) continue;
				const document = documents.find((candidate) => candidate.path === source.deckId);
				const deck = currentState.decks.get(source.deckId);
				if (!document || !deck) continue;

				const registration = registerMissingCardIdentities(
					document.content,
					this.options.createIdentity,
				);
				const migratedCards = parseFlashcards(registration.nextContent, document.path);
				if (
					!canMigrateLegacyCards(deck.cards, migratedCards) ||
					migratedCards.some((card) => isLegacyIdentity(document.path, card.id))
				) {
					return {
						kind: "blocked",
						reason: "legacy-source-mismatch",
					};
				}
				plans.push({
					path: source.deckId,
					expectedContent: document.content,
					nextContent: registration.nextContent,
					identityMap: Object.fromEntries(
						deck.cards.map((card, index) => [card.id, migratedCards[index]?.id ?? ""]),
					),
				});
			}

			const journal: ContinuityJournal = {
				id: resolution.ticket,
				type: "migration",
				completedSources: [],
				pendingSources: plans.map((plan) => plan.path),
				sources: plans,
			};
			await this.options.state.commit({
				...currentState,
				continuity: { ...currentState.continuity, journal },
			});
			return this.executeJournal(documents, {
				...currentState,
				continuity: { ...currentState.continuity, journal },
			});
		} catch (error) {
			return {
				kind: "failed",
				retryable: true,
				message: error instanceof Error ? error.message : "Card identity migration failed",
			};
		}
	}

	private async resolveRepair(
		resolution: Extract<ContinuityResolution, { kind: "repair" }>,
	): Promise<ResolutionOutcome> {
		try {
			let currentState = await this.options.state.load();
			let documents = await this.options.sources.list(currentState.configuredTags);
			if (currentState.continuity.journal) {
				const recovery = await this.executeJournal(documents, currentState);
				if (recovery.kind !== "applied") return recovery;
				currentState = await this.options.state.load();
				documents = await this.options.sources.list(currentState.configuredTags);
			}
			const issue = currentState.continuity.issues.find(
				(candidate) => candidate.id === resolution.issueId,
			);
			if (!issue || issue.ticket !== resolution.ticket) {
				return { kind: "blocked", reason: "preview-expired" };
			}

			const documentsByPath = new Map(documents.map((document) => [document.path, document]));
			const ticketMaterial = issue.affectedSources
				.map((path) => {
					const document = documentsByPath.get(path);
					return document ? `${path}:${hashText(document.content)}` : `${path}:missing`;
				})
				.sort()
				.join("|");
			if (`${issue.type}:${hashText(ticketMaterial)}` !== issue.ticket) {
				return { kind: "blocked", reason: "preview-expired" };
			}
			const expectedIdentities = new Set(
				issue.type === "identity-conflict" ? [issue.identity] : issue.missingIdentities,
			);
			const candidateTokens = new Set(issue.candidates.map((candidate) => candidate.token));
			const selectedOccurrences = resolution.successors.flatMap((successor) =>
				successor.occurrence ? [successor.occurrence] : [],
			);
			if (
				resolution.successors.length !== expectedIdentities.size ||
				resolution.successors.some(
					(successor) =>
						!expectedIdentities.has(successor.cardIdentity) ||
						(successor.occurrence !== null &&
							!candidateTokens.has(successor.occurrence)),
				) ||
				new Set(resolution.successors.map((successor) => successor.cardIdentity)).size !==
					expectedIdentities.size ||
				new Set(selectedOccurrences).size !== selectedOccurrences.length
			) {
				return { kind: "blocked", reason: "preview-expired" };
			}

			const successorByOccurrence = new Map(
				resolution.successors.flatMap((successor) =>
					successor.occurrence
						? [[successor.occurrence, successor.cardIdentity] as const]
						: [],
				),
			);
			const existingCards = buildExistingCardMap(currentState.decks);
			const plans: ContinuityJournalSource[] = [];
			for (const path of issue.affectedSources) {
				const document = documentsByPath.get(path);
				if (!document) return { kind: "blocked", reason: "preview-expired" };
				const cards = parseFlashcards(document.content, path, existingCards);
				const contentHash = hashText(document.content);
				const desiredIdentities = cards.map((card, index) => {
					const occurrence = `${path}:${contentHash}:${index}`;
					const assignedIdentity = successorByOccurrence.get(occurrence);
					if (assignedIdentity) return assignedIdentity;
					if (
						!isLegacyIdentity(path, card.id) &&
						!(issue.type === "identity-conflict" && card.id === issue.identity)
					) {
						return card.id;
					}
					return this.options.createIdentity();
				});
				plans.push({
					path,
					expectedContent: document.content,
					nextContent: rewriteCardIdentityMarkers(document.content, desiredIdentities),
					identityMap: Object.fromEntries(
						resolution.successors.map((successor) => [
							successor.cardIdentity,
							successor.occurrence ? successor.cardIdentity : "",
						]),
					),
				});
			}

			const journal: ContinuityJournal = {
				id: resolution.ticket,
				type: "repair",
				issueId: issue.id,
				completedSources: [],
				pendingSources: plans.map((plan) => plan.path),
				sources: plans,
			};
			await this.options.state.commit({
				...currentState,
				continuity: { ...currentState.continuity, journal },
			});
			return this.executeJournal(documents, {
				...currentState,
				continuity: { ...currentState.continuity, journal },
			});
		} catch (error) {
			return {
				kind: "failed",
				retryable: true,
				message: error instanceof Error ? error.message : "Card identity repair failed",
			};
		}
	}

	private async executeJournal(
		documents: ContinuitySourceDocument[],
		currentState: CardIdentityContinuityState,
	): Promise<ResolutionOutcome> {
		const persistedJournal = currentState.continuity.journal;
		if (!persistedJournal) return { kind: "applied" };
		const journal: ContinuityJournal = {
			...persistedJournal,
			completedSources: [...persistedJournal.completedSources],
			pendingSources: [...persistedJournal.pendingSources],
			sources: persistedJournal.sources.map((source) => ({
				...source,
				identityMap: { ...source.identityMap },
			})),
		};
		const documentsByPath = new Map(documents.map((document) => [document.path, document]));

		for (const plan of journal.sources) {
			const document = documentsByPath.get(plan.path);
			if (!document) {
				return {
					kind: "resumable",
					completedDeckIds: journal.completedSources,
					pendingDeckIds: journal.pendingSources,
				};
			}
			if (document.content !== plan.nextContent) {
				if (document.content !== plan.expectedContent) {
					return {
						kind: "resumable",
						completedDeckIds: journal.completedSources,
						pendingDeckIds: journal.pendingSources,
					};
				}
				const writeResult = await this.options.sources.replaceIfUnchanged(
					plan.path,
					plan.expectedContent,
					plan.nextContent,
				);
				if (writeResult === "stale") {
					return {
						kind: "resumable",
						completedDeckIds: journal.completedSources,
						pendingDeckIds: journal.pendingSources,
					};
				}
				document.content = plan.nextContent;
			}

			if (!journal.completedSources.includes(plan.path)) {
				journal.completedSources.push(plan.path);
			}
			journal.pendingSources = journal.pendingSources.filter((path) => path !== plan.path);
			await this.options.state.commit({
				...currentState,
				continuity: {
					...currentState.continuity,
					journal: cloneJournal(journal),
				},
			});
		}

		const previousDecks = currentState.decks;
		const nextDecks = new Map(previousDecks);
		const nextSources = { ...currentState.continuity.sources };
		const remainingIssues =
			journal.type === "repair" && journal.issueId
				? currentState.continuity.issues.filter((issue) => issue.id !== journal.issueId)
				: currentState.continuity.issues;
		const existingCards =
			journal.type === "migration"
				? buildMigratedCardMap(previousDecks, journal.sources)
				: buildExistingCardMap(previousDecks);
		for (const plan of journal.sources) {
			const document = documentsByPath.get(plan.path);
			const tag = extractFirstTag(plan.nextContent);
			if (!document || !tag) continue;
			const remainingIssue = remainingIssues.find((issue) =>
				issue.affectedSources.includes(plan.path),
			);
			if (remainingIssue) {
				nextSources[plan.path] = {
					type: "last-known-good",
					reason:
						remainingIssue.type === "identity-conflict"
							? "identity-conflict"
							: "identity-ambiguity",
				};
				continue;
			}
			const existingDeck = previousDecks.get(plan.path);
			nextDecks.set(plan.path, {
				id: plan.path,
				name: document.basename,
				filePath: plan.path,
				tag,
				cards: parseFlashcards(plan.nextContent, plan.path, existingCards),
				studyCount: existingDeck?.studyCount ?? 0,
				lastStudied: existingDeck?.lastStudied ?? null,
			});
			nextSources[plan.path] = { type: "current" };
		}

		const nextContinuity: PersistedCardIdentityContinuityState = {
			sources: nextSources,
			issues: remainingIssues,
			journal: null,
		};
		await this.options.state.commit({
			...currentState,
			decks: nextDecks,
			continuity: nextContinuity,
		});
		await this.reconcileSessions(previousDecks, nextDecks);
		this.snapshot = cloneSnapshot(
			nextContinuity,
			buildMigrationPreview(documents, nextDecks, nextSources),
		);
		return { kind: "applied" };
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.operationTail.then(operation, operation);
		this.operationTail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	inspect(): CardIdentityContinuitySnapshot {
		return cloneSnapshot(this.snapshot, this.snapshot.migration);
	}

	private async reconcileSessions(
		previousDecks: ReadonlyMap<string, Deck>,
		nextDecks: ReadonlyMap<string, Deck>,
	): Promise<void> {
		if (!this.options.sessions) return;
		const previousIdentities = new Set(
			Array.from(previousDecks.values()).flatMap((deck) => deck.cards.map((card) => card.id)),
		);
		const availableIdentities = new Set(
			Array.from(nextDecks.values()).flatMap((deck) => deck.cards.map((card) => card.id)),
		);
		const deletedIdentities = new Set(
			Array.from(previousIdentities).filter((identity) => !availableIdentities.has(identity)),
		);
		const spellableIdentitiesByDeck = new Map(
			Array.from(nextDecks.entries()).map(([deckId, deck]) => [
				deckId,
				new Set(
					deck.cards
						.filter((card) => extractSpellingWord(card.front) !== null)
						.map((card) => card.id),
				),
			]),
		);
		await this.options.sessions.reconcile({
			availableIdentities,
			deletedIdentities,
			spellableIdentitiesByDeck,
		});
	}
}

function isLegacyIdentity(filePath: string, cardIdentity: string): boolean {
	return cardIdentity.startsWith(`${filePath}::`);
}

function canMigrateLegacyCards(
	legacyCards: readonly FlashCard[],
	currentCards: readonly FlashCard[],
): boolean {
	if (currentCards.length === legacyCards.length) return true;
	if (currentCards.length < legacyCards.length) return false;
	return legacyCards.every((legacyCard, index) => {
		const currentCard = currentCards[index];
		return (
			currentCard !== undefined &&
			legacyCard.front === currentCard.front &&
			legacyCard.back === currentCard.back &&
			(legacyCard.explanation ?? "") === (currentCard.explanation ?? "")
		);
	});
}

function findIdentityConflicts(sources: PreparedSource[]): CardIdentityIssue[] {
	const occurrences = new Map<
		string,
		Array<{ source: PreparedSource; card: FlashCard; index: number }>
	>();
	for (const source of sources) {
		for (let index = 0; index < source.cards.length; index++) {
			const card = source.cards[index];
			if (!card) continue;
			const matches = occurrences.get(card.id) ?? [];
			matches.push({ source, card, index });
			occurrences.set(card.id, matches);
		}
	}

	const issues: CardIdentityIssue[] = [];
	for (const [identity, matches] of occurrences) {
		if (matches.length < 2) continue;
		const affectedSources = Array.from(
			new Set(matches.map(({ source }) => source.document.path)),
		);
		const affectedPreparedSources = sources.filter((source) =>
			affectedSources.includes(source.document.path),
		);
		issues.push({
			id: `identity-conflict:${identity}`,
			ticket: buildIssueTicket("identity-conflict", affectedPreparedSources),
			type: "identity-conflict",
			identity,
			affectedSources,
			candidates: matches.map(({ source, card, index }) =>
				makeCandidate(source, card, index),
			),
		});
	}
	return issues;
}

function makeCandidate(
	source: PreparedSource,
	card: FlashCard,
	index: number,
): CardIdentityCandidate {
	return {
		token: `${source.document.path}:${hashText(source.sourceContent)}:${index}`,
		sourcePath: source.document.path,
		front: card.front,
		back: card.back,
	};
}

function buildIssueTicket(type: CardIdentityIssue["type"], sources: PreparedSource[]): string {
	const material = sources
		.map((source) => `${source.document.path}:${hashText(source.sourceContent)}`)
		.sort()
		.join("|");
	return `${type}:${hashText(material)}`;
}

function buildExistingCardMap(decks: ReadonlyMap<string, Deck>): Map<string, FlashCard> {
	const cards = new Map<string, FlashCard>();
	for (const deck of decks.values()) {
		for (const card of deck.cards) {
			cards.set(card.id, card);
		}
	}
	return cards;
}

function buildMigratedCardMap(
	decks: ReadonlyMap<string, Deck>,
	plans: ContinuityJournalSource[],
): Map<string, FlashCard> {
	const mapped = new Map<string, FlashCard>();
	const mapsByPath = new Map(plans.map((plan) => [plan.path, plan.identityMap]));
	for (const deck of decks.values()) {
		const identityMap = mapsByPath.get(deck.filePath);
		for (const card of deck.cards) {
			const identity = identityMap?.[card.id] ?? card.id;
			mapped.set(identity, { ...card, id: identity });
		}
	}
	return mapped;
}

function buildMigrationPreview(
	documents: ContinuitySourceDocument[],
	decks: ReadonlyMap<string, Deck>,
	sources: Record<string, ContinuitySourceCondition>,
): MigrationPreview | undefined {
	const legacySources = Object.entries(sources)
		.filter(([, condition]) => condition.type === "legacy")
		.map(([path]) => {
			const deck = decks.get(path);
			const document = documents.find((candidate) => candidate.path === path);
			return deck && document
				? {
						deckId: path,
						deckName: deck.name,
						cardCount: parseFlashcards(document.content, path).length,
						content: document.content,
					}
				: null;
		})
		.filter((source): source is NonNullable<typeof source> => source !== null)
		.sort((left, right) => left.deckId.localeCompare(right.deckId));
	if (legacySources.length === 0) return undefined;

	const ticketMaterial = legacySources
		.map((source) => `${source.deckId}:${hashText(source.content)}`)
		.join("|");
	return {
		ticket: `migration:${hashText(ticketMaterial)}`,
		sourceCount: legacySources.length,
		cardCount: legacySources.reduce((total, source) => total + source.cardCount, 0),
		sources: legacySources.map(({ deckId, deckName, cardCount }) => ({
			deckId,
			deckName,
			cardCount,
		})),
	};
}

function hashText(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

function cloneSnapshot(
	state: PersistedCardIdentityContinuityState,
	migration?: MigrationPreview,
): CardIdentityContinuitySnapshot {
	return {
		sources: { ...state.sources },
		issues: state.issues.map((issue) => ({
			...issue,
			affectedSources: [...issue.affectedSources],
			candidates: issue.candidates.map((candidate) => ({ ...candidate })),
			...(issue.type === "identity-ambiguity"
				? { missingIdentities: [...issue.missingIdentities] }
				: {}),
		})),
		journal: state.journal ? cloneJournal(state.journal) : null,
		migration: migration
			? {
					...migration,
					sources: migration.sources.map((source) => ({ ...source })),
				}
			: undefined,
	};
}

function cloneJournal(journal: ContinuityJournal): ContinuityJournal {
	return {
		...journal,
		completedSources: [...journal.completedSources],
		pendingSources: [...journal.pendingSources],
		sources: journal.sources.map((source) => ({
			...source,
			identityMap: { ...source.identityMap },
		})),
	};
}
