import { errorMessage, stringArrayEquals } from "../../../../core/shared/utils";
import {
	countEligibleChallengeCards,
	type ChallengeMode,
	type ChallengeProgress,
} from "../sessions/challengeSessionEngine";
import type {
	CardIdentityContinuity,
	MigrationPreview,
	ResolutionOutcome,
	SynchronizeOutcome,
} from "../identity/cardIdentityContinuity";
import {
	evaluateSpellingDeckEligibility,
	getPracticeSetupPlan,
	getSpellingSetupPlan,
	getStudySetupPlan,
	type PracticeSetupPlan,
	type SpellingDeckEligibility,
	type SpellingSetupPlan,
	type StudySetupPlan,
} from "../sessions/sessionPlanner";
import type { PracticeSelection, SpellingSelection } from "../sessions/sessionLifecycle";
import type {
	Deck,
	DeckStats,
	SpellingProgressSnapshot,
	StudyHistoryEntry,
	StudySettings,
} from "../../../../core/shared/types";
import type { FlashcardStudySettings } from "../../settings/slice";
import type { DeckPdfExportProgress, DeckPdfExportResult } from "./deckPdfExporter";
import { type LearningFootprintSnapshot } from "../history/dailyLearningActivity";
export type {
	DeckSettingsChange as DeckHomeSettingsChange,
	DeckSettingsDraftSnapshot as DeckHomeSettingsDraft,
} from "./deckSettingsDraftSession";

interface DeckHomeTotals {
	readonly deckCount: number;
	readonly totalCards: number;
	readonly newCards: number;
	readonly dueCards: number;
	readonly studyCount: number;
}

interface DeckSpellingSnapshot {
	readonly enabled: boolean;
	readonly ready: boolean;
	readonly valid: boolean;
	readonly canStart: boolean;
	readonly hasStableIdentities: boolean;
	readonly issueCount: number;
	readonly ignoredCardCount: number;
}

export interface DeckHomeDeckSnapshot {
	readonly id: string;
	readonly name: string;
	readonly filePath: string;
	readonly tag: string;
	readonly studyCount: number;
	readonly stats: Readonly<DeckStats>;
	readonly effectiveStudySettings: Readonly<StudySettings>;
	readonly spelling: DeckSpellingSnapshot;
}

type DeckHomeMigrationScope =
	| { readonly kind: "all" }
	| { readonly kind: "deck"; readonly deckId: string };

type DeckHomeMutationActivity =
	| { readonly kind: "idle" }
	| { readonly kind: "refreshing" }
	| {
			readonly kind: "preparing-migration";
			readonly scope: DeckHomeMigrationScope;
	  }
	| {
			readonly kind: "awaiting-confirmation";
			readonly ownerId: string;
	  }
	| { readonly kind: "migrating"; readonly scope: DeckHomeMigrationScope };

type DeckHomeExportActivity =
	| { readonly kind: "idle" }
	| {
			readonly kind: "exporting";
			readonly deckId: string;
			readonly phase: DeckPdfExportProgress["phase"] | null;
			readonly completed: number;
			readonly total: number;
	  };

export interface ChallengeReadiness {
	readonly savedRoundId: string | null;
	readonly eligibleCount: number;
	readonly lastMode: ChallengeMode;
	readonly round: {
		readonly id: string;
		readonly mode: ChallengeMode;
		readonly completedLevelCount: number;
		readonly totalLevels: number;
		readonly completedCardCount: number;
		readonly totalCards: number;
	} | null;
}

export interface DeckHomeSnapshot {
	readonly challenge: ChallengeReadiness;
	readonly revision: number;
	/** Clock instant used to evaluate this snapshot's learning readiness. */
	readonly evaluatedAt: number;
	readonly decks: ReadonlyArray<DeckHomeDeckSnapshot>;
	readonly totals: Readonly<DeckHomeTotals>;
	readonly studyHistory: ReadonlyArray<StudyHistoryEntry>;
	readonly spellingProgress: Readonly<SpellingProgressSnapshot>;
	readonly learningFootprint: LearningFootprintSnapshot;
	readonly migration: Readonly<Pick<MigrationPreview, "sourceCount" | "cardCount">> | null;
	readonly mutation: DeckHomeMutationActivity;
	readonly export: DeckHomeExportActivity;
}

export type DeckHomeDestination = "study" | "practice" | "spelling" | "word-list";

export type DeckHomeAction =
	| { readonly kind: "refresh" }
	| {
			readonly kind: "request-migration";
			readonly ownerId: string;
			readonly deckId?: string;
	  }
	| {
			readonly kind: "continue";
			readonly ownerId: string;
			readonly continuation: string;
			readonly confirmed: boolean;
	  }
	| { readonly kind: "release-owner"; readonly ownerId: string }
	| { readonly kind: "reorder"; readonly deckIds: readonly string[] }
	| { readonly kind: "export"; readonly deckId: string }
	| {
			readonly kind: "navigate";
			readonly destination: DeckHomeDestination;
			readonly deckId: string;
	  }
	| {
			readonly kind: "record-word-list-visit";
			readonly deckId: string;
			readonly startTimeMs: number;
			readonly endTimeMs: number;
	  };

type DeckHomeRejectionReason =
	| "busy"
	| "deck-missing"
	| "deck-empty"
	| "export-unavailable"
	| "invalid-continuation"
	| "migration-unavailable"
	| "spelling-not-enabled"
	| "spelling-invalid"
	| "stable-card-identity-required";

export type DeckHomeOutcome =
	| { readonly kind: "applied" }
	| { readonly kind: "cancelled" }
	| {
			readonly kind: "confirmation-required";
			readonly continuation: string;
			readonly scope: DeckHomeMigrationScope;
			readonly sourceCount: number;
			readonly cardCount: number;
			readonly deckName?: string;
	  }
	| {
			readonly kind: "navigation";
			readonly destination: DeckHomeDestination;
			readonly deckId: string;
	  }
	| { readonly kind: "rejected"; readonly reason: DeckHomeRejectionReason }
	| { readonly kind: "failed"; readonly message: string };

export type DeckHomeEvent =
	| {
			readonly kind: "refresh-completed";
			readonly outcome: SynchronizeOutcome;
	  }
	| {
			readonly kind: "migration-completed";
			readonly outcome: ResolutionOutcome;
	  }
	| { readonly kind: "settings-save-failed"; readonly message: string }
	| {
			readonly kind: "export-progress";
			readonly deckId: string;
			readonly progress: DeckPdfExportProgress;
	  }
	| {
			readonly kind: "export-completed";
			readonly deckId: string;
			readonly result: DeckPdfExportResult;
	  }
	| {
			readonly kind: "export-failed";
			readonly deckId: string;
			readonly message: string;
	  };

export interface DeckHomeRepository {
	getRevision(): number;
	subscribe(listener: () => void): () => void;
	getAllDecks(): Deck[];
	getChallengeProgress(): ChallengeProgress | null;
	/** Revision of the installed challenge progress; changes invalidate its clone cache. */
	getChallengeProgressRevision(): number;
	getDeck(deckId: string): Deck | undefined;
	recordWordListVisit(
		deckId: string,
		deckName: string,
		startTimeMs: number,
		endTimeMs: number,
	): Promise<void>;
	getDeckStats(deck: Deck, now?: Date): DeckStats;
	getSettings(): FlashcardStudySettings;
	getEffectiveStudySettings(deckId: string): StudySettings;
	getSpellingProgress(): SpellingProgressSnapshot;
	getStudyHistory(): StudyHistoryEntry[];
	getLearningFootprint(now: Date): LearningFootprintSnapshot;
	/** Earliest future due time (epoch ms) across all decks, or null when nothing is due later. */
	getNextDueTime(now: Date): number | null;
}

export interface DeckHomeSettingsPatch {
	readonly deckId: string;
	readonly overrides: Partial<StudySettings> | null;
	readonly wordLearningEnabled: boolean;
}

export interface DeckHomeClock {
	now(): Date;
	setTimeout(callback: () => void, delay: number): unknown;
	clearTimeout(handle: unknown): void;
}

export interface CreateDeckHomeOptions {
	repository: DeckHomeRepository;
	identity: CardIdentityContinuity;
	/** @deprecated Settings mutations are now managed by DeckSettingsDraftSession */
	saveSettingsPatch?: unknown;
	saveDeckOrder?(deckIds: readonly string[]): Promise<void>;
	exportDeck?(
		deck: Deck,
		onProgress: (progress: DeckPdfExportProgress) => void,
	): Promise<DeckPdfExportResult>;
	report(event: DeckHomeEvent): void;
	clock?: DeckHomeClock;
}

export interface DeckHome {
	getSnapshot(): DeckHomeSnapshot;
	subscribe(listener: () => void): () => void;
	act(action: DeckHomeAction): Promise<DeckHomeOutcome>;
	getDeck(deckId: string): Deck | undefined;
	getStudySetupPlan(
		deckId: string,
		initialStudyOrder?: StudySettings["studyOrder"],
	): StudySetupPlan | null;
	getPracticeSetupPlan(
		deckId: string,
		initialSelection?: PracticeSelection,
	): PracticeSetupPlan | null;
	getSpellingSetupPlan(
		deckId: string,
		initialSelection?: SpellingSelection,
	): SpellingSetupPlan | null;
	dispose(): void;
}

interface PendingMigration {
	ownerId: string;
	continuation: string;
	scope: DeckHomeMigrationScope;
	ticket: string;
	deckIds: string[];
}

const systemClock: DeckHomeClock = {
	now: () => new Date(),
	setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
	clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createDeckHome(options: CreateDeckHomeOptions): DeckHome {
	return new DefaultDeckHome(options);
}

/**
 * One deck row and the serialized content that produced it. A rebuild reuses the
 * row only while the content key holds, so equal snapshots keep equal row
 * references and memoized consumers see the reuse.
 */
interface DeckRowCacheEntry {
	readonly contentKey: string;
	readonly row: DeckHomeDeckSnapshot;
}

class DefaultDeckHome implements DeckHome {
	private readonly listeners = new Set<() => void>();
	private readonly clock: DeckHomeClock;
	private snapshot: DeckHomeSnapshot;
	private mutation: DeckHomeMutationActivity = { kind: "idle" };
	private exportActivity: DeckHomeExportActivity = { kind: "idle" };
	private pendingMigration: PendingMigration | null = null;
	private continuationSequence = 0;
	private timer: unknown = null;
	private dirty = false;
	private disposed = false;
	private readonly unsubscribeRepository: () => void;
	/** Per-deck statistics keyed by stable deck object identity. */
	private readonly deckStatsCache = new Map<string, { deck: Deck; stats: DeckStats }>();
	/** Per-deck spelling eligibility and its row projection, keyed by deck and enabled flag. */
	private readonly deckEligibilityCache = new Map<
		string,
		{
			deck: Deck;
			enabled: boolean;
			eligibility: SpellingDeckEligibility;
			spelling: DeckSpellingSnapshot;
		}
	>();
	/**
	 * Rows keyed by deck id. The key serializes every input that determines a
	 * row's content, so a rebuild only allocates rows whose content changed.
	 */
	private readonly deckRowCache = new Map<string, DeckRowCacheEntry>();

	private readonly challengeCountCache = new WeakMap<Deck, { enabled: boolean; count: number }>();

	/** Most recent challenge progress clone, reused until its repository revision changes. */
	private challengeProgressCache: {
		revision: number;
		progress: ChallengeProgress | null;
	} | null = null;

	constructor(private readonly options: CreateDeckHomeOptions) {
		this.clock = options.clock ?? systemClock;
		this.snapshot = this.buildSnapshot();
		this.unsubscribeRepository = options.repository.subscribe(() => this.publish());
	}

	getSnapshot(): DeckHomeSnapshot {
		if (this.dirty) {
			this.dirty = false;
			this.snapshot = this.buildSnapshot();
		}
		return this.snapshot;
	}

	subscribe(listener: () => void): () => void {
		if (this.disposed) return () => undefined;
		const firstSubscriber = this.listeners.size === 0;
		this.listeners.add(listener);
		if (firstSubscriber) {
			this.deckStatsCache.clear();
			this.deckEligibilityCache.clear();
			this.snapshot = this.buildSnapshot();
			this.dirty = false;
			this.scheduleTimer();
		}
		return () => {
			this.listeners.delete(listener);
			if (this.listeners.size === 0) this.stopTimer();
		};
	}

	async act(action: DeckHomeAction): Promise<DeckHomeOutcome> {
		if (this.disposed) return { kind: "rejected", reason: "busy" };
		switch (action.kind) {
			case "refresh":
				return this.refresh();
			case "request-migration":
				return this.requestMigration(action.ownerId, action.deckId);
			case "continue":
				return this.continueMigration(action);
			case "release-owner":
				return this.releaseOwner(action.ownerId);
			case "reorder":
				return this.reorderDecks(action.deckIds);
			case "export":
				return this.exportDeck(action.deckId);
			case "navigate":
				return this.navigate(action.destination, action.deckId);
			case "record-word-list-visit":
				return this.recordWordListVisit(action);
		}
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.unsubscribeRepository();
		this.stopTimer();
		this.listeners.clear();
		this.deckRowCache.clear();
		this.deckStatsCache.clear();
		this.deckEligibilityCache.clear();
	}

	getDeck(deckId: string): Deck | undefined {
		return this.options.repository.getDeck(deckId);
	}

	getStudySetupPlan(
		deckId: string,
		initialStudyOrder?: StudySettings["studyOrder"],
	): StudySetupPlan | null {
		const deck = this.getDeck(deckId);
		if (!deck) return null;
		const snapshot = this.getSnapshot();
		const entry = snapshot.decks.find((candidate) => candidate.id === deckId);
		if (!entry) return null;
		return getStudySetupPlan(
			deck,
			entry.effectiveStudySettings,
			new Date(snapshot.evaluatedAt),
			initialStudyOrder,
		);
	}

	getPracticeSetupPlan(
		deckId: string,
		initialSelection?: PracticeSelection,
	): PracticeSetupPlan | null {
		const deck = this.getDeck(deckId);
		if (!deck) return null;
		return getPracticeSetupPlan(deck, initialSelection);
	}

	getSpellingSetupPlan(
		deckId: string,
		initialSelection?: SpellingSelection,
	): SpellingSetupPlan | null {
		const deck = this.getDeck(deckId);
		if (!deck) return null;
		const snapshot = this.getSnapshot();
		return getSpellingSetupPlan(deck, snapshot.spellingProgress, initialSelection);
	}

	private async refresh(): Promise<DeckHomeOutcome> {
		if (this.mutation.kind !== "idle") return { kind: "rejected", reason: "busy" };
		this.mutation = { kind: "refreshing" };
		this.publish();
		try {
			const outcome = await this.options.identity.synchronize();
			this.options.report({ kind: "refresh-completed", outcome });
			return outcome.kind === "failed"
				? { kind: "failed", message: outcome.message }
				: { kind: "applied" };
		} catch (error) {
			const message = errorMessage(error);
			this.options.report({
				kind: "refresh-completed",
				outcome: { kind: "failed", retryable: true, message },
			});
			return { kind: "failed", message };
		} finally {
			this.mutation = { kind: "idle" };
			this.publish();
		}
	}

	private async requestMigration(ownerId: string, deckId?: string): Promise<DeckHomeOutcome> {
		if (this.mutation.kind !== "idle") return { kind: "rejected", reason: "busy" };
		const scope: DeckHomeMigrationScope = deckId ? { kind: "deck", deckId } : { kind: "all" };
		this.mutation = { kind: "preparing-migration", scope };
		this.publish();
		try {
			const sync = await this.options.identity.synchronize();
			if (sync.kind === "failed") {
				this.options.report({
					kind: "refresh-completed",
					outcome: sync,
				});
				this.mutation = { kind: "idle" };
				this.publish();
				return { kind: "failed", message: sync.message };
			}
			const preview = this.options.identity.inspect().migration;
			const sources = deckId
				? preview?.sources.filter((source) => source.deckId === deckId)
				: preview?.sources;
			if (!preview || !sources || sources.length === 0) {
				this.mutation = { kind: "idle" };
				this.publish();
				return { kind: "rejected", reason: "migration-unavailable" };
			}
			const continuation = `migration-${++this.continuationSequence}`;
			this.pendingMigration = {
				ownerId,
				continuation,
				scope,
				ticket: preview.ticket,
				deckIds: sources.map((source) => source.deckId),
			};
			this.mutation = { kind: "awaiting-confirmation", ownerId };
			this.publish();
			return {
				kind: "confirmation-required",
				continuation,
				scope,
				sourceCount: sources.length,
				cardCount: sources.reduce((sum, source) => sum + source.cardCount, 0),
				deckName: sources.length === 1 ? sources[0]?.deckName : undefined,
			};
		} catch (error) {
			const message = errorMessage(error);
			this.mutation = { kind: "idle" };
			this.publish();
			return { kind: "failed", message };
		}
	}

	private async continueMigration(
		action: Extract<DeckHomeAction, { kind: "continue" }>,
	): Promise<DeckHomeOutcome> {
		const pending = this.pendingMigration;
		if (
			!pending ||
			pending.ownerId !== action.ownerId ||
			pending.continuation !== action.continuation
		) {
			return { kind: "rejected", reason: "invalid-continuation" };
		}
		this.pendingMigration = null;
		if (!action.confirmed) {
			this.mutation = { kind: "idle" };
			this.publish();
			return { kind: "cancelled" };
		}
		this.mutation = { kind: "migrating", scope: pending.scope };
		this.publish();
		try {
			const outcome = await this.options.identity.resolve({
				kind: "migrate",
				ticket: pending.ticket,
				deckIds: pending.deckIds,
			});
			this.options.report({ kind: "migration-completed", outcome });
			return outcome.kind === "failed"
				? { kind: "failed", message: outcome.message }
				: outcome.kind === "applied"
					? { kind: "applied" }
					: { kind: "rejected", reason: "migration-unavailable" };
		} catch (error) {
			const message = errorMessage(error);
			this.options.report({
				kind: "migration-completed",
				outcome: { kind: "failed", retryable: true, message },
			});
			return { kind: "failed", message };
		} finally {
			this.mutation = { kind: "idle" };
			this.publish();
		}
	}

	private releaseOwner(ownerId: string): DeckHomeOutcome {
		if (this.pendingMigration?.ownerId === ownerId) {
			this.pendingMigration = null;
			this.mutation = { kind: "idle" };
			this.publish();
		}
		return { kind: "applied" };
	}

	private async reorderDecks(deckIds: readonly string[]): Promise<DeckHomeOutcome> {
		const decks = this.options.repository.getAllDecks();
		const nextOrder = orderDecks(decks, deckIds).map((deck) => deck.id);
		const currentOrder = orderDecks(decks, this.options.repository.getSettings().deckOrder).map(
			(deck) => deck.id,
		);
		if (stringArrayEquals(nextOrder, currentOrder)) {
			return { kind: "applied" };
		}

		try {
			if (!this.options.saveDeckOrder) {
				throw new Error("Deck order persistence is unavailable");
			}
			await this.options.saveDeckOrder(nextOrder);
			return { kind: "applied" };
		} catch (error) {
			const message = errorMessage(error);
			this.options.report({ kind: "settings-save-failed", message });
			return { kind: "failed", message };
		}
	}

	private async exportDeck(deckId: string): Promise<DeckHomeOutcome> {
		if (!this.options.exportDeck) return { kind: "rejected", reason: "export-unavailable" };
		if (this.exportActivity.kind !== "idle") return { kind: "rejected", reason: "busy" };
		const deck = this.options.repository
			.getAllDecks()
			.find((candidate) => candidate.id === deckId);
		if (!deck) return { kind: "rejected", reason: "deck-missing" };
		if (deck.cards.length === 0) return { kind: "rejected", reason: "deck-empty" };
		const capturedDeck = cloneDeck(deck);
		this.exportActivity = {
			kind: "exporting",
			deckId,
			phase: null,
			completed: 0,
			total: deck.cards.length,
		};
		this.publish();
		try {
			const result = await this.options.exportDeck(capturedDeck, (progress) => {
				this.exportActivity = {
					kind: "exporting",
					deckId,
					...progress,
				};
				this.options.report({
					kind: "export-progress",
					deckId,
					progress,
				});
				this.publish();
			});
			this.options.report({ kind: "export-completed", deckId, result });
			return result.kind === "cancelled" ? { kind: "cancelled" } : { kind: "applied" };
		} catch (error) {
			const message = errorMessage(error);
			this.options.report({ kind: "export-failed", deckId, message });
			return { kind: "failed", message };
		} finally {
			this.exportActivity = { kind: "idle" };
			this.publish();
		}
	}

	private navigate(destination: DeckHomeDestination, deckId: string): DeckHomeOutcome {
		const deck = this.options.repository
			.getAllDecks()
			.find((candidate) => candidate.id === deckId);
		if (!deck) return { kind: "rejected", reason: "deck-missing" };
		if (deck.cards.length === 0) return { kind: "rejected", reason: "deck-empty" };
		if (destination === "spelling") {
			const eligibility = evaluateSpellingDeckEligibility(
				deck,
				this.options.repository.getSettings().wordLearningDecks[deckId] === true,
			);
			if (!eligibility.enabled) {
				return { kind: "rejected", reason: "spelling-not-enabled" };
			}
			if (!eligibility.canStart) return { kind: "rejected", reason: "spelling-invalid" };
			if (!eligibility.hasStableIdentities) {
				return {
					kind: "rejected",
					reason: "stable-card-identity-required",
				};
			}
		}
		return { kind: "navigation", destination, deckId };
	}

	private async recordWordListVisit(
		action: Extract<DeckHomeAction, { kind: "record-word-list-visit" }>,
	): Promise<DeckHomeOutcome> {
		const deck = this.options.repository.getDeck(action.deckId);
		if (!deck) return { kind: "rejected", reason: "deck-missing" };
		try {
			await this.options.repository.recordWordListVisit(
				deck.id,
				deck.name,
				action.startTimeMs,
				action.endTimeMs,
			);
			return { kind: "applied" };
		} catch (error) {
			return { kind: "failed", message: errorMessage(error) };
		}
	}

	/**
	 * Publishes a new snapshot. Pass `force` when wall-clock time matters
	 * (e.g. a due timer fired); this drops the per-deck caches so statistics are
	 * recomputed against the current time.
	 */
	private publish(force = false): void {
		if (this.disposed) return;
		if (force) {
			this.deckStatsCache.clear();
			this.deckEligibilityCache.clear();
		}
		if (this.listeners.size === 0) {
			// No mounted view observes the read model. Defer the rebuild until the
			// next getSnapshot/subscribe and keep the due timer stopped; a closed
			// view must not pay for (or restart timers from) repository revisions.
			this.dirty = true;
			return;
		}
		this.dirty = false;
		this.snapshot = this.buildSnapshot();
		this.scheduleTimer();
		for (const listener of this.listeners) {
			try {
				listener();
			} catch (error) {
				console.error("Failed to publish the deck home snapshot:", error);
			}
		}
	}

	private buildSnapshot(): DeckHomeSnapshot {
		const now = this.clock.now();
		const settings = this.options.repository.getSettings();
		const decks = orderDecks(this.options.repository.getAllDecks(), settings.deckOrder);
		const revision = this.options.repository.getRevision();
		const deckSnapshots = decks.map((deck) => this.buildDeckRow(deck, settings, now));
		this.pruneDeckCaches(decks);
		const totals = deckSnapshots.reduce<DeckHomeTotals>(
			(current, deck) => ({
				deckCount: current.deckCount + 1,
				totalCards: current.totalCards + deck.stats.totalCards,
				newCards: current.newCards + deck.stats.newCards,
				dueCards: current.dueCards + deck.stats.dueCards,
				studyCount: current.studyCount + deck.studyCount,
			}),
			{
				deckCount: 0,
				totalCards: 0,
				newCards: 0,
				dueCards: 0,
				studyCount: 0,
			},
		);
		const migration = this.options.identity.inspect().migration;
		const challengeProgress = this.getChallengeProgressCached();
		const round = challengeProgress?.round;
		const resumable = round && round.completedLevelCount < round.levels.length;
		const challenge: ChallengeReadiness = Object.freeze({
			savedRoundId: round?.id ?? null,
			eligibleCount: decks.reduce(
				(count, deck) =>
					count +
					this.getChallengeCountCached(
						deck,
						settings.wordLearningDecks[deck.id] === true,
					),
				0,
			),
			lastMode: challengeProgress?.lastMode ?? "random",
			round: resumable
				? Object.freeze({
						id: round.id,
						mode: round.mode,
						completedLevelCount: round.completedLevelCount,
						totalLevels: round.levels.length,
						completedCardCount: round.completedLevels.reduce(
							(sum, level) => sum + level.totalQuestions,
							0,
						),
						totalCards: round.levels.reduce((sum, level) => sum + level.length, 0),
					})
				: null,
		});
		return freezeDeckHomeSnapshot({
			challenge,
			revision,
			evaluatedAt: now.getTime(),
			decks: deckSnapshots,
			totals,
			studyHistory: this.options.repository.getStudyHistory(),
			spellingProgress: this.options.repository.getSpellingProgress(),
			learningFootprint: this.options.repository.getLearningFootprint(now),
			migration: migration
				? {
						sourceCount: migration.sourceCount,
						cardCount: migration.cardCount,
					}
				: null,
			mutation: this.mutation,
			export: this.exportActivity,
		});
	}

	/** getDeckStats with an object-identity cache so untouched decks are not rescanned. */
	private getDeckStatsCached(deck: Deck, now: Date): DeckStats {
		const cached = this.deckStatsCache.get(deck.id);
		if (cached?.deck === deck) return cached.stats;
		const stats = this.options.repository.getDeckStats(deck, now);
		this.deckStatsCache.set(deck.id, { deck, stats });
		return stats;
	}

	/**
	 * Builds one deck row, reusing the previous row while its content holds.
	 *
	 * Every input that determines a row's content — deck identity text, study
	 * count, statistics, effective study settings and spelling readiness — is
	 * serialized into one content key. Equal content therefore returns the same
	 * row reference across publishes, which keeps memoized row consumers stable
	 * without a second field-by-field cache in the UI.
	 */
	private buildDeckRow(
		deck: Deck,
		settings: FlashcardStudySettings,
		now: Date,
	): DeckHomeDeckSnapshot {
		const stats = this.getDeckStatsCached(deck, now);
		const spelling = this.getDeckEligibilityCached(
			deck,
			settings.wordLearningDecks[deck.id] === true,
		).spelling;
		const effectiveStudySettings = this.options.repository.getEffectiveStudySettings(deck.id);
		const contentKey = JSON.stringify([
			deck.id,
			deck.name,
			deck.filePath,
			deck.tag,
			deck.studyCount,
			stats,
			spelling,
			effectiveStudySettings,
		]);
		const cached = this.deckRowCache.get(deck.id);
		if (cached?.contentKey === contentKey) return cached.row;

		const row: DeckHomeDeckSnapshot = {
			id: deck.id,
			name: deck.name,
			filePath: deck.filePath,
			tag: deck.tag,
			studyCount: deck.studyCount,
			stats,
			effectiveStudySettings,
			spelling,
		};
		this.deckRowCache.set(deck.id, { contentKey, row });
		return row;
	}

	/** Drops cached parts for decks that left the committed index. */
	private pruneDeckCaches(decks: readonly Deck[]): void {
		const liveDeckIds = new Set(decks.map((deck) => deck.id));
		for (const deckId of this.deckRowCache.keys()) {
			if (!liveDeckIds.has(deckId)) this.deckRowCache.delete(deckId);
		}
		for (const [key, entry] of this.deckEligibilityCache) {
			if (!liveDeckIds.has(entry.deck.id)) this.deckEligibilityCache.delete(key);
		}
	}

	/** evaluateSpellingDeckEligibility with a per-deck, per-enabled cache. */
	private getDeckEligibilityCached(
		deck: Deck,
		enabled: boolean,
	): { eligibility: SpellingDeckEligibility; spelling: DeckSpellingSnapshot } {
		const key = spellingCacheKey(deck.id, enabled);
		const cached = this.deckEligibilityCache.get(key);
		if (cached?.deck === deck) return cached;
		const eligibility = evaluateSpellingDeckEligibility(deck, enabled);
		const entry = {
			deck,
			enabled,
			eligibility,
			spelling: toSpellingSnapshot(eligibility),
		};
		this.deckEligibilityCache.set(key, entry);
		return entry;
	}

	private getChallengeCountCached(deck: Deck, enabled: boolean): number {
		const cached = this.challengeCountCache.get(deck);
		if (cached?.enabled === enabled) return cached.count;
		const count = countEligibleChallengeCards(deck, enabled);
		this.challengeCountCache.set(deck, { enabled, count });
		return count;
	}

	/**
	 * `getChallengeProgress` deep-clones the saved round, which on a large library
	 * costs O(round questions) on every repository revision. The repository bumps
	 * its challenge-progress revision only when the installed progress changes, so
	 * reuse the last clone while that revision holds.
	 */
	private getChallengeProgressCached(): ChallengeProgress | null {
		const revision = this.options.repository.getChallengeProgressRevision();
		const cached = this.challengeProgressCache;
		if (cached?.revision === revision) return cached.progress;
		const progress = this.options.repository.getChallengeProgress();
		this.challengeProgressCache = { revision, progress };
		return progress;
	}

	private scheduleTimer(): void {
		this.stopTimer();
		if (this.listeners.size === 0 || this.disposed) return;
		const now = this.clock.now();
		const midnight = new Date(now);
		midnight.setHours(24, 0, 0, 0);
		let wakeAt = midnight.getTime();
		const nextDue = this.options.repository.getNextDueTime(now);
		if (nextDue !== null && nextDue > now.getTime() && nextDue < wakeAt) wakeAt = nextDue;
		this.timer = this.clock.setTimeout(
			() => {
				this.timer = null;
				// Force a statistics rebuild: the timer fired because wall-clock
				// time advanced (a card came due or the day rolled over).
				this.publish(true);
			},
			Math.max(1, wakeAt - now.getTime()),
		);
	}

	private stopTimer(): void {
		if (this.timer === null) return;
		this.clock.clearTimeout(this.timer);
		this.timer = null;
	}
}

function cloneDeck(deck: Deck): Deck {
	return {
		...deck,
		cards: deck.cards.map((card) => ({
			...card,
			fsrsCard: {
				...card.fsrsCard,
				due: new Date(card.fsrsCard.due),
				last_review: card.fsrsCard.last_review
					? new Date(card.fsrsCard.last_review)
					: undefined,
			},
		})),
	};
}

function orderDecks(decks: readonly Deck[], preferredOrder: readonly string[]): Deck[] {
	const decksById = new Map(decks.map((deck) => [deck.id, deck]));
	const orderedDecks: Deck[] = [];
	const seen = new Set<string>();

	for (const deckId of preferredOrder) {
		const deck = decksById.get(deckId);
		if (!deck || seen.has(deckId)) continue;
		orderedDecks.push(deck);
		seen.add(deckId);
	}
	for (const deck of decks) {
		if (seen.has(deck.id)) continue;
		orderedDecks.push(deck);
		seen.add(deck.id);
	}
	return orderedDecks;
}

/** Cache key for eligibility that keeps the row and settings-draft enabled flags apart. */
function spellingCacheKey(deckId: string, enabled: boolean): string {
	return `${deckId}\u0000${enabled ? "1" : "0"}`;
}

function toSpellingSnapshot(eligibility: SpellingDeckEligibility): DeckSpellingSnapshot {
	return {
		enabled: eligibility.enabled,
		ready: eligibility.ready,
		valid: eligibility.valid,
		canStart: eligibility.canStart,
		hasStableIdentities: eligibility.hasStableIdentities,
		issueCount: eligibility.issueCount,
		ignoredCardCount: eligibility.invalidCards.length,
	};
}

const frozenLearningFootprints = new WeakSet<LearningFootprintSnapshot>();

function freezeDeckHomeSnapshot(snapshot: DeckHomeSnapshot): DeckHomeSnapshot {
	for (const deck of snapshot.decks) {
		Object.freeze(deck.stats);
		Object.freeze(deck.effectiveStudySettings.fsrsParameters);
		Object.freeze(deck.effectiveStudySettings);
		Object.freeze(deck.spelling);
		Object.freeze(deck);
	}
	Object.freeze(snapshot.decks);
	Object.freeze(snapshot.studyHistory);
	Object.freeze(snapshot.totals);
	if (!frozenLearningFootprints.has(snapshot.learningFootprint)) {
		Object.freeze(snapshot.learningFootprint.today.answers);
		Object.freeze(snapshot.learningFootprint.today.seconds);
		Object.freeze(snapshot.learningFootprint.today.completedAnswers);
		Object.freeze(snapshot.learningFootprint.today.completedSessions);
		Object.freeze(snapshot.learningFootprint.today);
		for (const week of snapshot.learningFootprint.weeks) {
			for (const day of week.days) {
				Object.freeze(day.activity.answers);
				Object.freeze(day.activity.seconds);
				Object.freeze(day.activity.completedAnswers);
				Object.freeze(day.activity.completedSessions);
				Object.freeze(day.activity);
				Object.freeze(day);
			}
			Object.freeze(week.days);
			Object.freeze(week);
		}
		Object.freeze(snapshot.learningFootprint.weeks);
		Object.freeze(snapshot.learningFootprint);
		frozenLearningFootprints.add(snapshot.learningFootprint);
	}
	if (snapshot.migration) Object.freeze(snapshot.migration);
	Object.freeze(snapshot.mutation);
	Object.freeze(snapshot.export);
	return Object.freeze(snapshot);
}
