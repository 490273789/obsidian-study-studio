import { errorMessage } from "../../../../core/shared/utils";
import type { Deck, StudySettings } from "../../../../core/shared/types";
import type { FlashcardStudySettings } from "../../settings/slice";
import {
	calculateDailyNewCardsFromDays,
	calculateEstimatedDays,
	parseMaximumInterval,
} from "../../settings/studyMeta";
import { evaluateSpellingDeckEligibility } from "../sessions/sessionPlanner";

export type DeckSettingsChange =
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

export interface DeckSettingsDraftSnapshot {
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
	readonly isSaving: boolean;
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

export type DeckSettingsRejectionReason =
	| "busy"
	| "deck-missing"
	| "draft-missing"
	| "draft-owned-by-another-view"
	| "stable-card-identity-required"
	| "spelling-invalid";

export type DeckSettingsOutcome =
	| { readonly kind: "applied" }
	| { readonly kind: "rejected"; readonly reason: DeckSettingsRejectionReason }
	| { readonly kind: "failed"; readonly message: string };

export interface DeckSettingsRepositoryPort {
	getAllDecks(): readonly Deck[];
	getSettings(): FlashcardStudySettings;
	subscribeExternal?(listener: () => void): () => void;
}

export interface DeckSettingsReportEvent {
	readonly kind: "settings-save-failed";
	readonly message: string;
}

export interface DeckSettingsDraftSessionOptions {
	readonly repository: DeckSettingsRepositoryPort;
	readonly saveSettingsPatch: (patch: {
		deckId: string;
		overrides: Partial<StudySettings> | null;
		wordLearningEnabled: boolean;
	}) => Promise<void>;
	readonly report?: (event: DeckSettingsReportEvent) => void;
}

export interface DeckSettingsDraftSession {
	getSnapshot(): DeckSettingsDraftSnapshot | null;
	subscribe(listener: () => void): () => void;
	open(deckId: string, ownerId: string): DeckSettingsOutcome;
	change(ownerId: string, change: DeckSettingsChange): DeckSettingsOutcome;
	save(ownerId: string): Promise<DeckSettingsOutcome>;
	cancel(ownerId: string): DeckSettingsOutcome;
	releaseOwner(ownerId: string): DeckSettingsOutcome;
	isLocked(deckId: string, ownerId: string): boolean;
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
	isSaving: boolean;
}

class DefaultDeckSettingsDraftSession implements DeckSettingsDraftSession {
	private readonly listeners = new Set<() => void>();
	private draft: MutableSettingsDraft | null = null;
	private disposed = false;
	private readonly unsubscribeRepo?: () => void;

	constructor(private readonly options: DeckSettingsDraftSessionOptions) {
		if (this.options.repository.subscribeExternal) {
			this.unsubscribeRepo = this.options.repository.subscribeExternal(() => {
				if (!this.draft) return;
				const deck = this.options.repository
					.getAllDecks()
					.find((candidate) => candidate.id === this.draft!.deckId);
				if (!deck && !this.draft.isSaving) {
					this.draft = null;
					this.publish();
				}
			});
		}
	}

	getSnapshot(): DeckSettingsDraftSnapshot | null {
		const draft = this.draft;
		if (!draft) return null;
		const deck = this.options.repository
			.getAllDecks()
			.find((candidate) => candidate.id === draft.deckId);
		if (!deck) {
			if (!draft.isSaving) this.draft = null;
			return null;
		}
		const settings = this.options.repository.getSettings();
		const spelling = evaluateSpellingDeckEligibility(deck, draft.wordLearningEnabled);
		return {
			ownerId: draft.ownerId,
			deckId: draft.deckId,
			deckName: deck.name,
			filePath: deck.filePath,
			totalCards: deck.cards.length,
			useCustom: draft.useCustom,
			dailyNewCards: draft.dailyNewCards,
			dailyReviewCards: draft.dailyReviewCards,
			studyOrder: draft.studyOrder,
			requestRetention: draft.requestRetention,
			maximumInterval: draft.maximumInterval,
			daysToComplete: draft.daysToComplete,
			wordLearningEnabled: draft.wordLearningEnabled,
			isSaving: draft.isSaving,
			global: {
				dailyNewCards: settings.dailyNewCards,
				dailyReviewCards: settings.dailyReviewCards,
				studyOrder: settings.studyOrder,
				fsrsParameters: { ...settings.fsrsParameters },
			},
			spelling: {
				canStart: spelling.canStart,
				hasStableIdentities: spelling.hasStableIdentities,
				invalidCards: spelling.invalidCards.map((card) => ({ ...card })),
			},
		};
	}

	subscribe(listener: () => void): () => void {
		if (this.disposed) return () => {};
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	isLocked(deckId: string, ownerId: string): boolean {
		const draft = this.draft;
		return (
			draft !== null &&
			draft.ownerId !== ownerId &&
			(draft.ownerId !== "" || draft.deckId !== deckId)
		);
	}

	open(deckId: string, ownerId: string): DeckSettingsOutcome {
		if (this.disposed) return { kind: "rejected", reason: "busy" };
		const deck = this.options.repository
			.getAllDecks()
			.find((candidate) => candidate.id === deckId);
		if (!deck) return { kind: "rejected", reason: "deck-missing" };

		if (this.draft) {
			if (this.draft.ownerId === ownerId) return { kind: "applied" };
			if (this.draft.ownerId === "" && this.draft.deckId === deckId) {
				this.draft.ownerId = ownerId;
				this.publish();
				return { kind: "applied" };
			}
			return { kind: "rejected", reason: "draft-owned-by-another-view" };
		}

		const settings = this.options.repository.getSettings();
		const overrides = settings.deckStudySettings[deckId];
		const dailyNewCards = overrides?.dailyNewCards ?? settings.dailyNewCards;

		this.draft = {
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
			isSaving: false,
		};
		this.publish();
		return { kind: "applied" };
	}

	change(ownerId: string, change: DeckSettingsChange): DeckSettingsOutcome {
		if (this.disposed) return { kind: "rejected", reason: "busy" };
		const draft = this.draft;
		if (!draft) return { kind: "rejected", reason: "draft-missing" };
		if (draft.ownerId !== ownerId) {
			return { kind: "rejected", reason: "draft-owned-by-another-view" };
		}
		if (draft.isSaving) return { kind: "rejected", reason: "busy" };

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

	async save(ownerId: string): Promise<DeckSettingsOutcome> {
		if (this.disposed) return { kind: "rejected", reason: "busy" };
		const draft = this.draft;
		if (!draft) return { kind: "rejected", reason: "draft-missing" };
		if (draft.ownerId !== ownerId) {
			return { kind: "rejected", reason: "draft-owned-by-another-view" };
		}
		if (draft.isSaving) return { kind: "rejected", reason: "busy" };

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

		draft.isSaving = true;
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
			this.draft = null;
			return { kind: "applied" };
		} catch (error) {
			const message = errorMessage(error);
			this.options.report?.({ kind: "settings-save-failed", message });
			return { kind: "failed", message };
		} finally {
			if (this.draft) {
				this.draft.isSaving = false;
			}
			this.publish();
		}
	}

	cancel(ownerId: string): DeckSettingsOutcome {
		if (!this.draft) return { kind: "applied" };
		if (this.draft.ownerId !== ownerId) {
			return { kind: "rejected", reason: "draft-owned-by-another-view" };
		}
		if (this.draft.isSaving) {
			return { kind: "rejected", reason: "busy" };
		}
		this.draft = null;
		this.publish();
		return { kind: "applied" };
	}

	releaseOwner(ownerId: string): DeckSettingsOutcome {
		if (this.draft?.ownerId === ownerId) {
			if (this.draft.isSaving) {
				this.draft.ownerId = "";
			} else {
				this.draft = null;
			}
			this.publish();
		}
		return { kind: "applied" };
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.unsubscribeRepo?.();
		this.draft = null;
		this.listeners.clear();
	}

	private publish(): void {
		if (this.disposed) return;
		for (const listener of this.listeners) {
			listener();
		}
	}
}

function assignSettingsChange(
	draft: MutableSettingsDraft,
	change: Exclude<DeckSettingsChange, { field: "dailyNewCards" | "daysToComplete" }>,
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

export function createDeckSettingsDraftSession(
	options: DeckSettingsDraftSessionOptions,
): DeckSettingsDraftSession {
	return new DefaultDeckSettingsDraftSession(options);
}
