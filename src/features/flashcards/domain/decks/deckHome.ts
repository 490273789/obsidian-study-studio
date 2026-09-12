import type {
	CardIdentityContinuity,
	MigrationPreview,
	ResolutionOutcome,
	SynchronizeOutcome,
} from "../identity/cardIdentityContinuity";
import {
	evaluateSpellingDeckEligibility,
	type SpellingDeckEligibility,
} from "../sessions/sessionPlanner";
import type {
	Deck,
	DeckStats,
	SpellingCardProgress,
	StudyHistoryEntry,
	StudySettings,
} from "../../../../core/shared/types";
import type { FlashcardStudySettings } from "../../settings/slice";
import {
	calculateEstimatedDays,
	calculateDailyNewCardsFromDays,
	parseMaximumInterval,
} from "../../settings/studyMeta";
import type { DeckPdfExportProgress, DeckPdfExportResult } from "./deckPdfExporter";

export interface DeckHomeTotals {
	readonly deckCount: number;
	readonly totalCards: number;
	readonly newCards: number;
	readonly dueCards: number;
	readonly studyCount: number;
}

export interface DeckHomeDeckSnapshot {
	readonly id: string;
	readonly name: string;
	readonly filePath: string;
	readonly tag: string;
	readonly studyCount: number;
	readonly stats: Readonly<DeckStats>;
	readonly spelling: {
		readonly enabled: boolean;
		readonly ready: boolean;
		readonly valid: boolean;
		readonly canStart: boolean;
		readonly hasStableIdentities: boolean;
		readonly issueCount: number;
		readonly ignoredCardCount: number;
	};
}

export interface DeckHomeSettingsDraft {
	readonly ownerId: string;
	readonly deckId: string;
	readonly deckName: string;
	readonly filePath: string;
	readonly totalCards: number;
	readonly useCustom: boolean;
	readonly dailyNewCards: number;
	readonly dailyReviewCards: number;
	readonly studyOrder: StudySettings["studyOrder"];
	readonly requestRetention: number;
	readonly maximumInterval: string;
	readonly daysToComplete: string;
	readonly wordLearningEnabled: boolean;
	readonly global: Readonly<StudySettings>;
	readonly spelling: {
		readonly canStart: boolean;
		readonly hasStableIdentities: boolean;
		readonly invalidCards: ReadonlyArray<{
			readonly cardId: string;
			readonly indexInFile: number;
			readonly front: string;
		}>;
	};
}

export type DeckHomeMigrationScope =
	| { readonly kind: "all" }
	| { readonly kind: "deck"; readonly deckId: string };

export type DeckHomeMutationActivity =
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
	| { readonly kind: "migrating"; readonly scope: DeckHomeMigrationScope }
	| { readonly kind: "saving-settings"; readonly deckId: string };

export type DeckHomeExportActivity =
	| { readonly kind: "idle" }
	| {
			readonly kind: "exporting";
			readonly deckId: string;
			readonly phase: DeckPdfExportProgress["phase"] | null;
			readonly completed: number;
			readonly total: number;
	  };

export interface DeckHomeSnapshot {
	readonly revision: number;
	readonly decks: ReadonlyArray<DeckHomeDeckSnapshot>;
	readonly totals: Readonly<DeckHomeTotals>;
	readonly migration: Readonly<Pick<MigrationPreview, "sourceCount" | "cardCount">> | null;
	readonly mutation: DeckHomeMutationActivity;
	readonly export: DeckHomeExportActivity;
	readonly settingsDraft: DeckHomeSettingsDraft | null;
}

export type DeckHomeDestination = "study" | "practice" | "spelling" | "word-list";

export type DeckHomeSettingsChange =
	| { readonly field: "useCustom"; readonly value: boolean }
	| { readonly field: "dailyNewCards"; readonly value: number }
	| { readonly field: "dailyReviewCards"; readonly value: number }
	| {
			readonly field: "studyOrder";
			readonly value: StudySettings["studyOrder"];
	  }
	| { readonly field: "requestRetention"; readonly value: number }
	| { readonly field: "maximumInterval"; readonly value: string }
	| { readonly field: "daysToComplete"; readonly value: string }
	| { readonly field: "wordLearningEnabled"; readonly value: boolean };

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
	| {
			readonly kind: "open-settings";
			readonly ownerId: string;
			readonly deckId: string;
	  }
	| {
			readonly kind: "change-settings";
			readonly ownerId: string;
			readonly change: DeckHomeSettingsChange;
	  }
	| { readonly kind: "save-settings"; readonly ownerId: string }
	| { readonly kind: "cancel-settings"; readonly ownerId: string }
	| { readonly kind: "release-owner"; readonly ownerId: string }
	| { readonly kind: "reorder"; readonly deckIds: readonly string[] }
	| { readonly kind: "export"; readonly deckId: string }
	| {
			readonly kind: "navigate";
			readonly destination: DeckHomeDestination;
			readonly deckId: string;
	  };

export type DeckHomeRejectionReason =
	| "busy"
	| "deck-missing"
	| "deck-empty"
	| "draft-owned-by-another-view"
	| "draft-missing"
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
	getDeck?(deckId: string): Deck | undefined;
	getDeckStats(deck: Deck, now?: Date): DeckStats;
	getSettings(): FlashcardStudySettings;
	getEffectiveStudySettings?(deckId: string): StudySettings;
	getSpellingProgress?(): Readonly<Record<string, SpellingCardProgress>>;
	getStudyHistory?(): StudyHistoryEntry[];
	recordWordListVisit?(
		deckId: string,
		deckName: string,
		startTimeMs: number,
		endTimeMs: number,
	): Promise<void>;
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
	saveSettingsPatch(patch: DeckHomeSettingsPatch): Promise<void>;
	saveDeckOrder?(deckIds: readonly string[]): Promise<void>;
	exportDeck(
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
	getEffectiveStudySettings(deckId: string): StudySettings;
	getSpellingProgress(): Readonly<Record<string, SpellingCardProgress>>;
	getStudyHistory(): StudyHistoryEntry[];
	recordWordListVisit(deckId: string, startTimeMs: number, endTimeMs: number): Promise<void>;
	dispose(): void;
}

interface MutableSettingsDraft {
	ownerId: string;
	deckId: string;
	useCustom: boolean;
	dailyNewCards: number;
	dailyReviewCards: number;
	studyOrder: StudySettings["studyOrder"];
	requestRetention: number;
	maximumInterval: string;
	daysToComplete: string;
	wordLearningEnabled: boolean;
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

class DefaultDeckHome implements DeckHome {
	private readonly listeners = new Set<() => void>();
	private readonly clock: DeckHomeClock;
	private snapshot: DeckHomeSnapshot;
	private mutation: DeckHomeMutationActivity = { kind: "idle" };
	private exportActivity: DeckHomeExportActivity = { kind: "idle" };
	private settingsDraft: MutableSettingsDraft | null = null;
	private pendingMigration: PendingMigration | null = null;
	private continuationSequence = 0;
	private timer: unknown = null;
	private disposed = false;
	private readonly unsubscribeRepository: () => void;
	/** Per-deck statistics keyed by stable deck object identity. */
	private readonly deckStatsCache = new Map<string, { deck: Deck; stats: DeckStats }>();
	/** Per-deck spelling eligibility keyed by deck object identity and the enabled flag. */
	private readonly deckEligibilityCache = new Map<
		string,
		{ deck: Deck; enabled: boolean; eligibility: SpellingDeckEligibility }
	>();

	constructor(private readonly options: CreateDeckHomeOptions) {
		this.clock = options.clock ?? systemClock;
		this.snapshot = this.buildSnapshot();
		this.unsubscribeRepository = options.repository.subscribe(() => this.publish());
	}

	getSnapshot(): DeckHomeSnapshot {
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
			case "open-settings":
				return this.openSettings(action.ownerId, action.deckId);
			case "change-settings":
				return this.changeSettings(action.ownerId, action.change);
			case "save-settings":
				return this.saveSettings(action.ownerId);
			case "cancel-settings":
				return this.cancelSettings(action.ownerId);
			case "release-owner":
				return this.releaseOwner(action.ownerId);
			case "reorder":
				return this.reorderDecks(action.deckIds);
			case "export":
				return this.exportDeck(action.deckId);
			case "navigate":
				return this.navigate(action.destination, action.deckId);
		}
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.unsubscribeRepository();
		this.stopTimer();
		this.listeners.clear();
	}

	getDeck(deckId: string): Deck | undefined {
		return (
			this.options.repository.getDeck?.(deckId) ??
			this.options.repository.getAllDecks().find((candidate) => candidate.id === deckId)
		);
	}

	getEffectiveStudySettings(deckId: string): StudySettings {
		if (this.options.repository.getEffectiveStudySettings) {
			return this.options.repository.getEffectiveStudySettings(deckId);
		}
		const settings = this.options.repository.getSettings();
		const overrides = settings.deckStudySettings?.[deckId] ?? {};
		return {
			dailyNewCards: settings.dailyNewCards,
			dailyReviewCards: settings.dailyReviewCards,
			studyOrder: settings.studyOrder,
			fsrsParameters: {
				...settings.fsrsParameters,
				...overrides.fsrsParameters,
			},
			...overrides,
		};
	}

	getSpellingProgress(): Readonly<Record<string, SpellingCardProgress>> {
		return this.options.repository.getSpellingProgress?.() ?? {};
	}

	getStudyHistory(): StudyHistoryEntry[] {
		return this.options.repository.getStudyHistory?.() ?? [];
	}

	async recordWordListVisit(
		deckId: string,
		startTimeMs: number,
		endTimeMs: number,
	): Promise<void> {
		if (!this.options.repository.recordWordListVisit) return;
		const deck = this.getDeck(deckId);
		const deckName = deck ? deck.name : deckId;
		await this.options.repository.recordWordListVisit(deckId, deckName, startTimeMs, endTimeMs);
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
			const message = getErrorMessage(error);
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
			const message = getErrorMessage(error);
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
			const message = getErrorMessage(error);
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

	private openSettings(ownerId: string, deckId: string): DeckHomeOutcome {
		const deck = this.options.repository
			.getAllDecks()
			.find((candidate) => candidate.id === deckId);
		if (!deck) return { kind: "rejected", reason: "deck-missing" };
		if (this.settingsDraft) {
			if (this.settingsDraft.ownerId === ownerId) return { kind: "applied" };
			if (this.settingsDraft.ownerId === "" && this.settingsDraft.deckId === deckId) {
				this.settingsDraft.ownerId = ownerId;
				this.publish();
				return { kind: "applied" };
			}
			return { kind: "rejected", reason: "draft-owned-by-another-view" };
		}
		const settings = this.options.repository.getSettings();
		const overrides = settings.deckStudySettings[deckId];
		const dailyNewCards = overrides?.dailyNewCards ?? settings.dailyNewCards;
		this.settingsDraft = {
			ownerId,
			deckId,
			useCustom: overrides !== undefined,
			dailyNewCards,
			dailyReviewCards: overrides?.dailyReviewCards ?? settings.dailyReviewCards,
			studyOrder: overrides?.studyOrder ?? settings.studyOrder,
			requestRetention:
				overrides?.fsrsParameters?.requestRetention ??
				settings.fsrsParameters.requestRetention,
			maximumInterval: String(
				overrides?.fsrsParameters?.maximumInterval ??
					settings.fsrsParameters.maximumInterval,
			),
			daysToComplete: String(calculateEstimatedDays(deck.cards.length, dailyNewCards)),
			wordLearningEnabled: settings.wordLearningDecks[deckId] === true,
		};
		this.publish();
		return { kind: "applied" };
	}

	private changeSettings(ownerId: string, change: DeckHomeSettingsChange): DeckHomeOutcome {
		const draft = this.settingsDraft;
		if (!draft) return { kind: "rejected", reason: "draft-missing" };
		if (draft.ownerId !== ownerId) {
			return { kind: "rejected", reason: "draft-owned-by-another-view" };
		}
		const deck = this.options.repository
			.getAllDecks()
			.find((candidate) => candidate.id === draft.deckId);
		if (!deck) return { kind: "rejected", reason: "deck-missing" };
		if (change.field === "daysToComplete") {
			draft.daysToComplete = change.value;
			const days = Number.parseInt(change.value, 10);
			if (Number.isFinite(days) && days >= 1 && deck.cards.length > 0) {
				draft.dailyNewCards = calculateDailyNewCardsFromDays(deck.cards.length, days);
			}
		} else if (change.field === "dailyNewCards") {
			draft.dailyNewCards = change.value;
			draft.daysToComplete = String(calculateEstimatedDays(deck.cards.length, change.value));
		} else {
			assignSettingsChange(draft, change);
		}
		this.publish();
		return { kind: "applied" };
	}

	private async saveSettings(ownerId: string): Promise<DeckHomeOutcome> {
		const draft = this.settingsDraft;
		if (!draft) return { kind: "rejected", reason: "draft-missing" };
		if (draft.ownerId !== ownerId) {
			return { kind: "rejected", reason: "draft-owned-by-another-view" };
		}
		if (this.mutation.kind !== "idle") return { kind: "rejected", reason: "busy" };
		const deck = this.options.repository
			.getAllDecks()
			.find((candidate) => candidate.id === draft.deckId);
		if (!deck) return { kind: "rejected", reason: "deck-missing" };
		const eligibility = evaluateSpellingDeckEligibility(deck, draft.wordLearningEnabled);
		if (draft.wordLearningEnabled && !eligibility.hasStableIdentities) {
			return {
				kind: "rejected",
				reason: "stable-card-identity-required",
			};
		}
		if (draft.wordLearningEnabled && !eligibility.canStart) {
			return { kind: "rejected", reason: "spelling-invalid" };
		}
		this.mutation = { kind: "saving-settings", deckId: draft.deckId };
		this.publish();
		try {
			const settings = this.options.repository.getSettings();
			const maximumInterval = parseMaximumInterval(
				draft.maximumInterval,
				settings.fsrsParameters.maximumInterval,
			);
			await this.options.saveSettingsPatch({
				deckId: draft.deckId,
				overrides: draft.useCustom
					? {
							dailyNewCards: draft.dailyNewCards,
							dailyReviewCards: draft.dailyReviewCards,
							studyOrder: draft.studyOrder,
							fsrsParameters: {
								requestRetention: draft.requestRetention,
								maximumInterval,
							},
						}
					: null,
				wordLearningEnabled: draft.wordLearningEnabled,
			});
			this.settingsDraft = null;
			return { kind: "applied" };
		} catch (error) {
			const message = getErrorMessage(error);
			this.options.report({ kind: "settings-save-failed", message });
			return { kind: "failed", message };
		} finally {
			this.mutation = { kind: "idle" };
			this.publish();
		}
	}

	private cancelSettings(ownerId: string): DeckHomeOutcome {
		if (!this.settingsDraft) return { kind: "applied" };
		if (this.settingsDraft.ownerId !== ownerId) {
			return { kind: "rejected", reason: "draft-owned-by-another-view" };
		}
		if (this.mutation.kind === "saving-settings") {
			return { kind: "rejected", reason: "busy" };
		}
		this.settingsDraft = null;
		this.publish();
		return { kind: "applied" };
	}

	private releaseOwner(ownerId: string): DeckHomeOutcome {
		if (this.pendingMigration?.ownerId === ownerId) {
			this.pendingMigration = null;
			this.mutation = { kind: "idle" };
		}
		if (this.settingsDraft?.ownerId === ownerId) {
			if (this.mutation.kind === "saving-settings") {
				this.settingsDraft.ownerId = "";
			} else {
				this.settingsDraft = null;
			}
		}
		this.publish();
		return { kind: "applied" };
	}

	private async reorderDecks(deckIds: readonly string[]): Promise<DeckHomeOutcome> {
		const decks = this.options.repository.getAllDecks();
		const nextOrder = orderDecks(decks, deckIds).map((deck) => deck.id);
		const currentOrder = orderDecks(decks, this.options.repository.getSettings().deckOrder).map(
			(deck) => deck.id,
		);
		if (areStringArraysEqual(nextOrder, currentOrder)) {
			return { kind: "applied" };
		}

		try {
			if (!this.options.saveDeckOrder) {
				throw new Error("Deck order persistence is unavailable");
			}
			await this.options.saveDeckOrder(nextOrder);
			return { kind: "applied" };
		} catch (error) {
			const message = getErrorMessage(error);
			this.options.report({ kind: "settings-save-failed", message });
			return { kind: "failed", message };
		}
	}

	private async exportDeck(deckId: string): Promise<DeckHomeOutcome> {
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
			const message = getErrorMessage(error);
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
		const deckSnapshots = decks.map((deck): DeckHomeDeckSnapshot => {
			const stats = this.getDeckStatsCached(deck, now);
			const spelling = this.getDeckEligibilityCached(
				deck,
				settings.wordLearningDecks[deck.id] === true,
			);
			return {
				id: deck.id,
				name: deck.name,
				filePath: deck.filePath,
				tag: deck.tag,
				studyCount: deck.studyCount,
				stats: { ...stats },
				spelling: {
					enabled: spelling.enabled,
					ready: spelling.ready,
					valid: spelling.valid,
					canStart: spelling.canStart,
					hasStableIdentities: spelling.hasStableIdentities,
					issueCount: spelling.issueCount,
					ignoredCardCount: spelling.invalidCards.length,
				},
			};
		});
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
		return freezeDeckHomeSnapshot({
			revision,
			decks: deckSnapshots,
			totals,
			migration: migration
				? {
						sourceCount: migration.sourceCount,
						cardCount: migration.cardCount,
					}
				: null,
			mutation: this.mutation,
			export: this.exportActivity,
			settingsDraft: this.buildSettingsDraftSnapshot(decks, settings),
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

	/** evaluateSpellingDeckEligibility with a per-deck object-identity cache. */
	private getDeckEligibilityCached(deck: Deck, enabled: boolean): SpellingDeckEligibility {
		const cached = this.deckEligibilityCache.get(deck.id);
		if (cached?.deck === deck && cached.enabled === enabled) {
			return cached.eligibility;
		}
		const eligibility = evaluateSpellingDeckEligibility(deck, enabled);
		this.deckEligibilityCache.set(deck.id, { deck, enabled, eligibility });
		return eligibility;
	}

	private buildSettingsDraftSnapshot(
		decks: Deck[],
		settings: FlashcardStudySettings,
	): DeckHomeSettingsDraft | null {
		const draft = this.settingsDraft;
		if (!draft) return null;
		const deck = decks.find((candidate) => candidate.id === draft.deckId);
		if (!deck) {
			this.settingsDraft = null;
			return null;
		}
		const spelling = evaluateSpellingDeckEligibility(deck, draft.wordLearningEnabled);
		return {
			...draft,
			deckName: deck.name,
			filePath: deck.filePath,
			totalCards: deck.cards.length,
			global: {
				dailyNewCards: settings.dailyNewCards,
				dailyReviewCards: settings.dailyReviewCards,
				studyOrder: settings.studyOrder,
				fsrsParameters: { ...settings.fsrsParameters },
			},
			spelling: {
				canStart: spelling.canStart,
				hasStableIdentities: spelling.hasStableIdentities,
				invalidCards: spelling.invalidCards.map((card) => ({
					...card,
				})),
			},
		};
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

function assignSettingsChange(
	draft: MutableSettingsDraft,
	change: Exclude<DeckHomeSettingsChange, { field: "dailyNewCards" | "daysToComplete" }>,
): void {
	switch (change.field) {
		case "useCustom":
			draft.useCustom = change.value;
			break;
		case "dailyReviewCards":
			draft.dailyReviewCards = change.value;
			break;
		case "studyOrder":
			draft.studyOrder = change.value;
			break;
		case "requestRetention":
			draft.requestRetention = change.value;
			break;
		case "maximumInterval":
			draft.maximumInterval = change.value;
			break;
		case "wordLearningEnabled":
			draft.wordLearningEnabled = change.value;
			break;
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

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
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

function areStringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function freezeDeckHomeSnapshot(snapshot: DeckHomeSnapshot): DeckHomeSnapshot {
	for (const deck of snapshot.decks) {
		Object.freeze(deck.stats);
		Object.freeze(deck.spelling);
		Object.freeze(deck);
	}
	Object.freeze(snapshot.decks);
	Object.freeze(snapshot.totals);
	if (snapshot.migration) Object.freeze(snapshot.migration);
	Object.freeze(snapshot.mutation);
	Object.freeze(snapshot.export);
	if (snapshot.settingsDraft) {
		Object.freeze(snapshot.settingsDraft.global.fsrsParameters);
		Object.freeze(snapshot.settingsDraft.global);
		for (const invalidCard of snapshot.settingsDraft.spelling.invalidCards) {
			Object.freeze(invalidCard);
		}
		Object.freeze(snapshot.settingsDraft.spelling.invalidCards);
		Object.freeze(snapshot.settingsDraft.spelling);
		Object.freeze(snapshot.settingsDraft);
	}
	return Object.freeze(snapshot);
}
