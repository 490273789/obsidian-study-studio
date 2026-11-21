import type { CardDirection, Deck } from "../../../../core/shared/types";
import type { DeckSpellingSnapshot } from "../decks/deckHome";
import type { SessionStartRequest } from "./sessionLifecycle";
import type { PracticeSetupPlan, SpellingSetupPlan } from "./sessionPlanner";

const QUICK_QUESTION_COUNTS = [20, 50, 100] as const;
const QUICK_SPELLING_COUNTS = [10, 20, 50] as const;

export type PracticeKind = "flip" | "spelling";
export type PracticeSelectionMode = "random" | "range";
export type SpellingSelectionMode = "smart" | "range";

export interface PracticePreferenceStore {
	getPreference(deckId: string): PracticeKind | null;
	setPreference(deckId: string, kind: PracticeKind): void;
}

export function createMemoryPracticePreferenceStore(): PracticePreferenceStore {
	const map = new Map<string, PracticeKind>();
	return {
		getPreference: (deckId) => map.get(deckId) ?? null,
		setPreference: (deckId, kind) => {
			map.set(deckId, kind);
		},
	};
}

/**
 * In flashcard retrieval, each card takes ~7.5 seconds on average (flip + recall).
 * For spelling, each word takes ~12 seconds (typing + recall).
 */
function estimateMinutes(count: number, isSpelling: boolean): number {
	if (count <= 0) return 0;
	const secondsPerCard = isSpelling ? 12 : 7.5;
	return Math.max(1, Math.round((count * secondsPerCard) / 60));
}

export interface PracticeSetupSource {
	deck: Deck;
	plan: PracticeSetupPlan;
	spellingPlan?: SpellingSetupPlan | null;
	spellingSnapshot?: DeckSpellingSnapshot;
}

export interface PracticeSetupOptions extends PracticeSetupSource {
	defaultDirection?: CardDirection;
	initialDirection?: CardDirection;
	initialKind?: PracticeKind;
	preferenceStore?: PracticePreferenceStore;
}

export type SpellingUnavailableReason =
	| { kind: "disabled" }
	| { kind: "not-ready"; issueCount: number };

export interface PracticeQuickCountOption {
	readonly count: number;
	readonly minutes: number;
}

export type PracticeSetupAction =
	| { type: "set-kind"; kind: PracticeKind }
	| { type: "set-direction"; direction: CardDirection }
	| { type: "set-selection-mode"; mode: PracticeSelectionMode | SpellingSelectionMode }
	| { type: "pick-count"; count: number }
	| { type: "edit-count"; value: string }
	| { type: "commit-count" }
	| { type: "edit-range-start"; value: string }
	| { type: "edit-range-end"; value: string }
	| { type: "commit-range" };

export interface PracticeSetupSnapshot {
	readonly deck: Deck;
	readonly practiceKind: PracticeKind;
	readonly showModeSelector: boolean;
	readonly spellingEligible: boolean;
	readonly spellingUnavailableReason?: SpellingUnavailableReason;

	// Active mode projection
	readonly selectionMode: PracticeSelectionMode | SpellingSelectionMode;
	readonly maxCount: number;
	readonly allCountMinutes: number;
	readonly quickCounts: readonly PracticeQuickCountOption[];
	readonly count: number;
	readonly countInput: string;
	readonly countMinutes: number;
	readonly showCustomEstimate: boolean;
	readonly rangeStart: number;
	readonly rangeEnd: number;
	readonly rangeStartInput: string;
	readonly rangeEndInput: string;
	readonly rangeCount: number;
	readonly rangeMinutes: number;
	readonly activeCount: number;
	readonly activeMinutes: number;
	readonly isStartDisabled: boolean;

	// Mode-specific display details
	readonly direction: CardDirection;
	readonly spellingStats: Readonly<{ total: number; unpracticed: number }>;
}

interface ModeDraft<M extends string> {
	selectionMode: M;
	count: number;
	countInput: string;
	rangeStart: number;
	rangeEnd: number;
	rangeStartInput: string;
	rangeEndInput: string;
}

interface ModeLimits {
	readonly maxCount: number;
	readonly maxRangeStart: number;
	readonly quickChoices: readonly number[];
	readonly isSpelling: boolean;
}

function getConstraints({ plan, spellingPlan, spellingSnapshot }: PracticeSetupSource) {
	const spellingMax = spellingPlan?.maxQuestions ?? 0;
	const spellingUnavailableReason: SpellingUnavailableReason | undefined =
		spellingSnapshot && !spellingSnapshot.enabled
			? { kind: "disabled" }
			: spellingSnapshot && !spellingSnapshot.ready
				? { kind: "not-ready", issueCount: spellingSnapshot.issueCount }
				: undefined;
	return {
		maxQuestions: plan.maxQuestions,
		maxRangeStart: plan.maxRangeStart,
		showModeSelector: spellingPlan != null,
		spellingEligible: spellingMax > 0 && spellingUnavailableReason === undefined,
		spellingUnavailableReason,
		spellingMax,
		spellingStats: spellingPlan?.stats ?? { total: spellingMax, unpracticed: 0 },
	};
}

type PracticeSetupConstraints = ReturnType<typeof getConstraints>;

function sameConstraints(a: PracticeSetupConstraints, b: PracticeSetupConstraints): boolean {
	const leftReason = a.spellingUnavailableReason;
	const rightReason = b.spellingUnavailableReason;
	return (
		a.maxQuestions === b.maxQuestions &&
		a.maxRangeStart === b.maxRangeStart &&
		a.showModeSelector === b.showModeSelector &&
		a.spellingEligible === b.spellingEligible &&
		a.spellingMax === b.spellingMax &&
		a.spellingStats.total === b.spellingStats.total &&
		a.spellingStats.unpracticed === b.spellingStats.unpracticed &&
		leftReason?.kind === rightReason?.kind &&
		(leftReason?.kind !== "not-ready" ||
			(rightReason?.kind === "not-ready" && leftReason.issueCount === rightReason.issueCount))
	);
}

function constrainDraft(
	value: number,
	input: string,
	min: number,
	max: number,
	fallback = min,
): [number, string] {
	const nextValue = Math.max(min, Math.min(value > 0 ? value : fallback, max));
	const parsed = parseInt(input, 10);
	const nextInput = parsed > max || (value === 0 && input === "0") ? nextValue.toString() : input;
	return [nextValue, nextInput];
}

function normalizeRange(
	startInput: string,
	endInput: string,
	fallbackStart: number,
	maxCount: number,
	maxRangeStart: number,
): { start: number; end: number } {
	if (maxCount <= 0) return { start: 1, end: 0 };
	const safeRangeStartMax = Math.max(1, Math.min(maxRangeStart, maxCount));
	const safeFallbackStart = Math.max(1, Math.min(fallbackStart, safeRangeStartMax));
	const parsedStart = parseInt(startInput, 10);
	const start =
		Number.isNaN(parsedStart) || parsedStart < 1
			? safeFallbackStart
			: Math.min(parsedStart, safeRangeStartMax);
	const parsedEnd = parseInt(endInput, 10);
	const end =
		Number.isNaN(parsedEnd) || parsedEnd < start ? start : Math.min(parsedEnd, maxCount);
	return { start, end };
}

function reClampDraft<M extends string>(
	draft: ModeDraft<M>,
	maxCount: number,
	maxRangeStart: number,
	initialCount: number,
	initialRangeEnd: number,
): void {
	if (maxCount <= 0) return;
	[draft.count, draft.countInput] = constrainDraft(
		draft.count,
		draft.countInput,
		1,
		maxCount,
		initialCount,
	);
	[draft.rangeStart, draft.rangeStartInput] = constrainDraft(
		draft.rangeStart,
		draft.rangeStartInput,
		1,
		maxRangeStart,
	);
	[draft.rangeEnd, draft.rangeEndInput] = constrainDraft(
		draft.rangeEnd,
		draft.rangeEndInput,
		draft.rangeStart,
		maxCount,
		initialRangeEnd,
	);
}

export class PracticeSetupSession {
	private deck: Deck;
	private readonly preferenceStore?: PracticePreferenceStore;
	private constraints: PracticeSetupConstraints;
	private practiceKind: PracticeKind;
	private direction: CardDirection;

	private readonly flipDraft: ModeDraft<PracticeSelectionMode>;
	private readonly spellingDraft: ModeDraft<SpellingSelectionMode>;

	private readonly listeners = new Set<() => void>();
	private cachedSnapshot: PracticeSetupSnapshot | null = null;

	constructor(options: PracticeSetupOptions) {
		this.deck = options.deck;
		this.preferenceStore = options.preferenceStore;
		this.constraints = getConstraints(options);
		this.direction = options.initialDirection ?? options.defaultDirection ?? "normal";

		this.flipDraft = {
			selectionMode: options.plan.initialSelectionMode,
			count: options.plan.initialQuestionCount,
			countInput: options.plan.initialQuestionCount.toString(),
			rangeStart: options.plan.initialRangeStart,
			rangeEnd: options.plan.initialRangeEnd,
			rangeStartInput: options.plan.initialRangeStart.toString(),
			rangeEndInput: options.plan.initialRangeEnd.toString(),
		};

		const { spellingPlan } = options;
		const initialSpellingCount = spellingPlan?.initialQuestionCount ?? 0;
		const initialSpellingStart = spellingPlan?.initialRangeStart ?? 1;
		const initialSpellingEnd = spellingPlan?.initialRangeEnd ?? 0;
		this.spellingDraft = {
			selectionMode: spellingPlan?.initialSelectionMode ?? "smart",
			count: initialSpellingCount,
			countInput: initialSpellingCount.toString(),
			rangeStart: initialSpellingStart,
			rangeEnd: initialSpellingEnd,
			rangeStartInput: initialSpellingStart.toString(),
			rangeEndInput: initialSpellingEnd.toString(),
		};

		this.practiceKind = this.resolveInitialKind(options.initialKind);
	}

	/** Updates live deck limits without replacing the learner's setup draft. */
	updateSource(source: PracticeSetupSource): void {
		const previous = this.constraints;
		const next = getConstraints(source);
		const sameSource = this.deck === source.deck && sameConstraints(previous, next);
		if (sameSource) return;

		this.deck = source.deck;
		this.constraints = next;

		if (
			next.maxQuestions > 0 &&
			(previous.maxQuestions !== next.maxQuestions ||
				previous.maxRangeStart !== next.maxRangeStart)
		) {
			reClampDraft(
				this.flipDraft,
				next.maxQuestions,
				next.maxRangeStart,
				source.plan.initialQuestionCount,
				source.plan.initialRangeEnd,
			);
		}
		if (next.spellingMax > 0 && previous.spellingMax !== next.spellingMax) {
			reClampDraft(
				this.spellingDraft,
				next.spellingMax,
				next.spellingMax,
				source.spellingPlan?.initialQuestionCount ?? 1,
				source.spellingPlan?.initialRangeEnd ?? next.spellingMax,
			);
		}
		if (this.practiceKind === "spelling" && !next.spellingEligible) {
			this.practiceKind = "flip";
		}
		this.notify();
	}

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	getSnapshot = (): PracticeSetupSnapshot => {
		if (this.cachedSnapshot) return this.cachedSnapshot;

		const { draft, limits } = this.activeContext();
		const previewRange = normalizeRange(
			draft.rangeStartInput,
			draft.rangeEndInput,
			draft.rangeStart,
			limits.maxCount,
			limits.maxRangeStart,
		);
		const rangeCount =
			limits.maxCount > 0 ? Math.max(0, previewRange.end - previewRange.start + 1) : 0;
		const activeRawCount = draft.selectionMode === "range" ? rangeCount : draft.count;
		const activeCount = Math.min(activeRawCount, limits.maxCount);
		const isStartDisabled =
			limits.maxCount <= 0 ||
			(limits.isSpelling && !this.constraints.spellingEligible) ||
			activeRawCount < 1;

		const quickCountValues = limits.quickChoices.filter((count) => count < limits.maxCount);
		const quickCounts: PracticeQuickCountOption[] = quickCountValues.map((count) => ({
			count,
			minutes: estimateMinutes(count, limits.isSpelling),
		}));

		this.cachedSnapshot = {
			deck: this.deck,
			practiceKind: this.practiceKind,
			showModeSelector: this.constraints.showModeSelector,
			spellingEligible: this.constraints.spellingEligible,
			spellingUnavailableReason: this.constraints.spellingUnavailableReason,

			selectionMode: draft.selectionMode,
			maxCount: limits.maxCount,
			allCountMinutes: estimateMinutes(limits.maxCount, limits.isSpelling),
			quickCounts,
			count: draft.count,
			countInput: draft.countInput,
			countMinutes: estimateMinutes(draft.count, limits.isSpelling),
			showCustomEstimate:
				draft.count > 0 &&
				!quickCountValues.includes(draft.count) &&
				draft.count !== limits.maxCount,
			rangeStart: previewRange.start,
			rangeEnd: previewRange.end,
			rangeStartInput: draft.rangeStartInput,
			rangeEndInput: draft.rangeEndInput,
			rangeCount,
			rangeMinutes: estimateMinutes(rangeCount, limits.isSpelling),
			activeCount,
			activeMinutes: estimateMinutes(activeCount, limits.isSpelling),
			isStartDisabled,

			direction: this.direction,
			spellingStats: this.constraints.spellingStats,
		};

		return this.cachedSnapshot;
	};

	act(action: PracticeSetupAction): void {
		switch (action.type) {
			case "set-kind": {
				if (action.kind === "spelling" && !this.constraints.spellingEligible) return;
				if (this.practiceKind === action.kind) return;
				this.practiceKind = action.kind;
				this.preferenceStore?.setPreference(this.deck.id, action.kind);
				this.notify();
				return;
			}
			case "set-direction": {
				if (this.direction === action.direction) return;
				this.direction = action.direction;
				this.notify();
				return;
			}
			case "set-selection-mode": {
				if (this.practiceKind === "spelling") {
					if (action.mode !== "smart" && action.mode !== "range") return;
					if (this.spellingDraft.selectionMode === action.mode) return;
					this.spellingDraft.selectionMode = action.mode;
				} else {
					if (action.mode !== "random" && action.mode !== "range") return;
					if (this.flipDraft.selectionMode === action.mode) return;
					this.flipDraft.selectionMode = action.mode;
				}
				this.notify();
				return;
			}
			case "pick-count": {
				const { draft, limits } = this.activeContext();
				if (limits.maxCount <= 0) return;
				const next = Math.max(1, Math.min(action.count, limits.maxCount));
				draft.count = next;
				draft.countInput = next.toString();
				this.notify();
				return;
			}
			case "edit-count": {
				const { draft, limits } = this.activeContext();
				draft.countInput = action.value;
				const parsed = parseInt(action.value, 10);
				if (!Number.isNaN(parsed) && parsed >= 1 && limits.maxCount > 0) {
					draft.count = Math.min(parsed, limits.maxCount);
				}
				this.notify();
				return;
			}
			case "commit-count": {
				const { draft, limits } = this.activeContext();
				if (limits.maxCount <= 0) return;
				const parsed = parseInt(draft.countInput, 10);
				const normalized =
					Number.isNaN(parsed) || parsed < 1 ? 1 : Math.min(parsed, limits.maxCount);
				draft.count = normalized;
				draft.countInput = normalized.toString();
				this.notify();
				return;
			}
			case "edit-range-start": {
				const { draft } = this.activeContext();
				draft.rangeStartInput = action.value;
				this.notify();
				return;
			}
			case "edit-range-end": {
				const { draft } = this.activeContext();
				draft.rangeEndInput = action.value;
				this.notify();
				return;
			}
			case "commit-range": {
				const { draft, limits } = this.activeContext();
				this.commitRangeDraft(draft, limits);
				this.notify();
				return;
			}
		}
	}

	start(): SessionStartRequest | null {
		const { draft, limits } = this.activeContext();
		if (limits.maxCount <= 0 || (limits.isSpelling && !this.constraints.spellingEligible)) {
			return null;
		}

		if (draft.selectionMode === "range") {
			this.commitRangeDraft(draft, limits);
			this.notify();
			if (draft.rangeEnd < draft.rangeStart || draft.rangeEnd > limits.maxCount) {
				return null;
			}
			if (limits.isSpelling) {
				return {
					mode: "spelling",
					deckId: this.deck.id,
					selection: {
						kind: "range",
						startIndex: draft.rangeStart,
						endIndex: draft.rangeEnd,
					},
				};
			}
			return {
				mode: "practice",
				deckId: this.deck.id,
				direction: this.direction,
				selection: {
					kind: "range",
					startIndex: draft.rangeStart,
					endIndex: draft.rangeEnd,
				},
			};
		}

		const parsed = parseInt(draft.countInput, 10);
		const normalized =
			Number.isNaN(parsed) || parsed < 1 ? 1 : Math.min(parsed, limits.maxCount);
		if (draft.count !== normalized || draft.countInput !== normalized.toString()) {
			draft.count = normalized;
			draft.countInput = normalized.toString();
			this.notify();
		}

		if (limits.isSpelling) {
			return {
				mode: "spelling",
				deckId: this.deck.id,
				selection: {
					kind: "smart",
					questionCount: draft.count,
				},
			};
		}
		return {
			mode: "practice",
			deckId: this.deck.id,
			direction: this.direction,
			selection: {
				kind: "random",
				questionCount: draft.count,
			},
		};
	}

	private resolveInitialKind(initialKind?: PracticeKind): PracticeKind {
		if (!this.constraints.spellingEligible) return "flip";
		if (initialKind === "spelling") return "spelling";
		if (initialKind === "flip") return "flip";
		const saved = this.preferenceStore?.getPreference(this.deck.id);
		return saved === "spelling" ? "spelling" : "flip";
	}

	private activeContext(): {
		draft: ModeDraft<PracticeSelectionMode> | ModeDraft<SpellingSelectionMode>;
		limits: ModeLimits;
	} {
		if (this.practiceKind === "spelling") {
			return {
				draft: this.spellingDraft,
				limits: {
					maxCount: this.constraints.spellingMax,
					maxRangeStart: Math.max(1, this.constraints.spellingMax),
					quickChoices: QUICK_SPELLING_COUNTS,
					isSpelling: true,
				},
			};
		}
		return {
			draft: this.flipDraft,
			limits: {
				maxCount: this.constraints.maxQuestions,
				maxRangeStart: Math.max(
					1,
					Math.min(
						this.constraints.maxRangeStart,
						Math.max(1, this.constraints.maxQuestions),
					),
				),
				quickChoices: QUICK_QUESTION_COUNTS,
				isSpelling: false,
			},
		};
	}

	private commitRangeDraft(
		draft: ModeDraft<PracticeSelectionMode> | ModeDraft<SpellingSelectionMode>,
		limits: ModeLimits,
	): void {
		if (limits.maxCount <= 0) return;
		const { start, end } = normalizeRange(
			draft.rangeStartInput,
			draft.rangeEndInput,
			draft.rangeStart,
			limits.maxCount,
			limits.maxRangeStart,
		);
		draft.rangeStart = start;
		draft.rangeEnd = end;
		draft.rangeStartInput = start.toString();
		draft.rangeEndInput = end.toString();
	}

	private notify(): void {
		this.cachedSnapshot = null;
		for (const listener of this.listeners) {
			listener();
		}
	}
}
