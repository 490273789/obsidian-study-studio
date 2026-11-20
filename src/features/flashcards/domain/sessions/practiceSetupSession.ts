import type { CardDirection, Deck } from "../../../../core/shared/types";
import type { DeckSpellingSnapshot } from "../decks/deckHome";
import type { SessionStartRequest } from "./sessionLifecycle";
import type { PracticeSetupPlan, SpellingSetupPlan } from "./sessionPlanner";

export const QUICK_QUESTION_COUNTS = [20, 50, 100] as const;
export const QUICK_SPELLING_COUNTS = [10, 20, 50] as const;
const STORAGE_KEY_PREFIX = "study-studio:practice-kind:";

export type PracticeKind = "flip" | "spelling";
export type PracticeSelectionMode = "random" | "range";
export type SpellingSelectionMode = "smart" | "range";

export interface PracticePreferenceStore {
	getPreference(deckId: string): PracticeKind | null;
	setPreference(deckId: string, kind: PracticeKind): void;
}

const inMemoryPreferenceMap = new Map<string, PracticeKind>();

export const browserPracticePreferenceStore: PracticePreferenceStore = {
	getPreference(deckId: string): PracticeKind | null {
		const inMem = inMemoryPreferenceMap.get(deckId);
		if (inMem) return inMem;
		try {
			if (typeof window !== "undefined" && window.localStorage) {
				const saved = window.localStorage.getItem(`${STORAGE_KEY_PREFIX}${deckId}`);
				if (saved === "spelling" || saved === "flip") return saved;
			}
		} catch {
			// safe fallback
		}
		return null;
	},
	setPreference(deckId: string, kind: PracticeKind): void {
		inMemoryPreferenceMap.set(deckId, kind);
		try {
			if (typeof window !== "undefined" && window.localStorage) {
				window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${deckId}`, kind);
			}
		} catch {
			// safe fallback
		}
	},
};

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
export function estimateMinutes(count: number, isSpelling = false): number {
	if (count <= 0) return 0;
	const secondsPerCard = isSpelling ? 12 : 7.5;
	return Math.max(1, Math.round((count * secondsPerCard) / 60));
}

interface PracticeSetupSource {
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

function quickCounts(choices: readonly number[], max: number): readonly number[] {
	return choices.filter((count) => count < max);
}

export interface PracticeSetupSnapshot {
	readonly deck: Deck;
	readonly practiceKind: PracticeKind;
	readonly showModeSelector: boolean;
	readonly spellingEligible: boolean;
	readonly spellingUnavailableReason?: SpellingUnavailableReason;
	readonly isSpelling: boolean;

	// Active counts and time
	readonly activeCount: number;
	readonly activeMinutes: number;
	readonly isStartDisabled: boolean;

	// Flip practice configuration
	readonly maxQuestions: number;
	readonly maxRangeStart: number;
	readonly quickQuestionCounts: readonly number[];
	readonly selectionMode: PracticeSelectionMode;
	readonly questionCount: number;
	readonly questionCountInput: string;
	readonly rangeStart: number;
	readonly rangeEnd: number;
	readonly rangeStartInput: string;
	readonly rangeEndInput: string;
	readonly rangeQuestionCount: number;
	readonly direction: CardDirection;

	// Spelling configuration
	readonly spellingMax: number;
	readonly spellingStats: { total: number; unpracticed: number };
	readonly quickSpellingCounts: readonly number[];
	readonly spellingMode: SpellingSelectionMode;
	readonly spellingQuestionCount: number;
	readonly spellingQuestionCountInput: string;
	readonly spellingRangeStart: number;
	readonly spellingRangeEnd: number;
	readonly spellingRangeStartInput: string;
	readonly spellingRangeEndInput: string;
	readonly spellingRangeCount: number;
}

export class PracticeSetupSession {
	private deck: Deck;
	private readonly preferenceStore: PracticePreferenceStore;
	private constraints: PracticeSetupConstraints;

	// Flip properties
	private selectionMode: PracticeSelectionMode;
	private questionCount: number;
	private questionCountInput: string;
	private rangeStart: number;
	private rangeEnd: number;
	private rangeStartInput: string;
	private rangeEndInput: string;
	private direction: CardDirection;

	// Spelling properties
	private spellingMode: SpellingSelectionMode;
	private spellingQuestionCount: number;
	private spellingQuestionCountInput: string;
	private spellingRangeStart: number;
	private spellingRangeEnd: number;
	private spellingRangeStartInput: string;
	private spellingRangeEndInput: string;

	private practiceKind: PracticeKind;
	private readonly listeners = new Set<() => void>();
	private cachedSnapshot: PracticeSetupSnapshot | null = null;

	constructor(options: PracticeSetupOptions) {
		this.deck = options.deck;
		this.preferenceStore = options.preferenceStore ?? browserPracticePreferenceStore;
		this.constraints = getConstraints(options);

		// Flip setup
		this.selectionMode = options.plan.initialSelectionMode;
		this.questionCount = options.plan.initialQuestionCount;
		this.questionCountInput = options.plan.initialQuestionCount.toString();
		this.rangeStart = options.plan.initialRangeStart;
		this.rangeEnd = options.plan.initialRangeEnd;
		this.rangeStartInput = options.plan.initialRangeStart.toString();
		this.rangeEndInput = options.plan.initialRangeEnd.toString();
		this.direction = options.initialDirection ?? options.defaultDirection ?? "normal";

		// Spelling setup
		const { spellingPlan } = options;
		this.spellingMode = spellingPlan?.initialSelectionMode ?? "smart";
		this.spellingQuestionCount = spellingPlan?.initialQuestionCount ?? 0;
		this.spellingQuestionCountInput = this.spellingQuestionCount.toString();
		this.spellingRangeStart = spellingPlan?.initialRangeStart ?? 1;
		this.spellingRangeEnd = spellingPlan?.initialRangeEnd ?? 0;
		this.spellingRangeStartInput = this.spellingRangeStart.toString();
		this.spellingRangeEndInput = this.spellingRangeEnd.toString();

		// Initial practice kind resolution
		this.practiceKind = this.resolveInitialKind(options.initialKind);
	}

	/** Updates live deck limits without replacing the learner's setup draft. */
	updateSource(source: PracticeSetupSource): void {
		const previous = this.constraints;
		const next = getConstraints(source);
		if (this.deck === source.deck && sameConstraints(previous, next)) return;
		this.deck = source.deck;
		this.constraints = next;
		if (
			next.maxQuestions > 0 &&
			(previous.maxQuestions !== next.maxQuestions ||
				previous.maxRangeStart !== next.maxRangeStart)
		) {
			[this.questionCount, this.questionCountInput] = constrainDraft(
				this.questionCount,
				this.questionCountInput,
				1,
				next.maxQuestions,
				source.plan.initialQuestionCount,
			);
			[this.rangeStart, this.rangeStartInput] = constrainDraft(
				this.rangeStart,
				this.rangeStartInput,
				1,
				next.maxRangeStart,
			);
			[this.rangeEnd, this.rangeEndInput] = constrainDraft(
				this.rangeEnd,
				this.rangeEndInput,
				this.rangeStart,
				next.maxQuestions,
				source.plan.initialRangeEnd,
			);
		}
		if (next.spellingMax > 0 && previous.spellingMax !== next.spellingMax) {
			[this.spellingQuestionCount, this.spellingQuestionCountInput] = constrainDraft(
				this.spellingQuestionCount,
				this.spellingQuestionCountInput,
				1,
				next.spellingMax,
				source.spellingPlan?.initialQuestionCount,
			);
			[this.spellingRangeStart, this.spellingRangeStartInput] = constrainDraft(
				this.spellingRangeStart,
				this.spellingRangeStartInput,
				1,
				next.spellingMax,
			);
			[this.spellingRangeEnd, this.spellingRangeEndInput] = constrainDraft(
				this.spellingRangeEnd,
				this.spellingRangeEndInput,
				this.spellingRangeStart,
				next.spellingMax,
				source.spellingPlan?.initialRangeEnd,
			);
		}
		this.notify();
	}

	private resolveInitialKind(initialKind?: PracticeKind): PracticeKind {
		if (initialKind === "spelling") return "spelling";
		if (initialKind === "flip") return "flip";
		const saved = this.preferenceStore.getPreference(this.deck.id);
		if (saved === "spelling" && this.constraints.spellingEligible) return "spelling";
		return "flip";
	}

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	private notify(): void {
		this.cachedSnapshot = null;
		for (const listener of this.listeners) {
			listener();
		}
	}

	getSnapshot = (): PracticeSetupSnapshot => {
		if (this.cachedSnapshot) return this.cachedSnapshot;

		const isSpelling = this.practiceKind === "spelling";
		const rangeQuestionCount = Math.max(0, this.rangeEnd - this.rangeStart + 1);
		const activeQuestionCount =
			this.selectionMode === "range" ? rangeQuestionCount : this.questionCount;

		const spellingRangeCount = Math.max(0, this.spellingRangeEnd - this.spellingRangeStart + 1);
		const activeSpellingCount =
			this.spellingMode === "smart" ? this.spellingQuestionCount : spellingRangeCount;

		const activeCount = isSpelling
			? Math.min(activeSpellingCount, this.constraints.spellingMax)
			: Math.min(activeQuestionCount, this.constraints.maxQuestions);
		const activeMinutes = estimateMinutes(activeCount, isSpelling);

		const isFlipStartDisabled = this.constraints.maxQuestions === 0 || activeQuestionCount < 1;
		const isSpellingStartDisabled =
			!this.constraints.spellingEligible || activeSpellingCount < 1;
		const isStartDisabled = isSpelling ? isSpellingStartDisabled : isFlipStartDisabled;

		this.cachedSnapshot = {
			deck: this.deck,
			practiceKind: this.practiceKind,
			showModeSelector: this.constraints.showModeSelector,
			spellingEligible: this.constraints.spellingEligible,
			spellingUnavailableReason: this.constraints.spellingUnavailableReason,
			isSpelling,

			activeCount,
			activeMinutes,
			isStartDisabled,

			maxQuestions: this.constraints.maxQuestions,
			maxRangeStart: this.constraints.maxRangeStart,
			quickQuestionCounts: quickCounts(QUICK_QUESTION_COUNTS, this.constraints.maxQuestions),
			selectionMode: this.selectionMode,
			questionCount: this.questionCount,
			questionCountInput: this.questionCountInput,
			rangeStart: this.rangeStart,
			rangeEnd: this.rangeEnd,
			rangeStartInput: this.rangeStartInput,
			rangeEndInput: this.rangeEndInput,
			rangeQuestionCount,
			direction: this.direction,

			spellingMax: this.constraints.spellingMax,
			spellingStats: this.constraints.spellingStats,
			quickSpellingCounts: quickCounts(QUICK_SPELLING_COUNTS, this.constraints.spellingMax),
			spellingMode: this.spellingMode,
			spellingQuestionCount: this.spellingQuestionCount,
			spellingQuestionCountInput: this.spellingQuestionCountInput,
			spellingRangeStart: this.spellingRangeStart,
			spellingRangeEnd: this.spellingRangeEnd,
			spellingRangeStartInput: this.spellingRangeStartInput,
			spellingRangeEndInput: this.spellingRangeEndInput,
			spellingRangeCount,
		};

		return this.cachedSnapshot;
	};

	setPracticeKind(kind: PracticeKind): void {
		if (this.practiceKind === kind) return;
		this.practiceKind = kind;
		this.preferenceStore.setPreference(this.deck.id, kind);
		this.notify();
	}

	setDirection(direction: CardDirection): void {
		if (this.direction === direction) return;
		this.direction = direction;
		this.notify();
	}

	setSelectionMode(mode: PracticeSelectionMode): void {
		if (this.selectionMode === mode) return;
		this.selectionMode = mode;
		this.notify();
	}

	setSpellingMode(mode: SpellingSelectionMode): void {
		if (this.spellingMode === mode) return;
		this.spellingMode = mode;
		this.notify();
	}

	// Flip handlers
	setQuestionCountInput(value: string): void {
		this.questionCountInput = value;
		const num = parseInt(value, 10);
		if (!isNaN(num) && num >= 1) {
			this.questionCount = Math.min(num, this.constraints.maxQuestions);
		}
		this.notify();
	}

	commitQuestionCount(): void {
		const num = parseInt(this.questionCountInput, 10);
		if (isNaN(num) || num < 1) {
			this.questionCount = 1;
			this.questionCountInput = "1";
		} else {
			const normalized = Math.min(num, this.constraints.maxQuestions);
			this.questionCount = normalized;
			this.questionCountInput = normalized.toString();
		}
		this.notify();
	}

	selectQuickQuestionCount(count: number): void {
		const actual = Math.min(count, this.constraints.maxQuestions);
		this.questionCount = actual;
		this.questionCountInput = actual.toString();
		this.notify();
	}

	setRangeStartInput(value: string): void {
		this.rangeStartInput = value;
		this.notify();
	}

	setRangeEndInput(value: string): void {
		this.rangeEndInput = value;
		this.notify();
	}

	commitRange(): void {
		const parsedStart = parseInt(this.rangeStartInput, 10);
		const parsedEnd = parseInt(this.rangeEndInput, 10);
		const start =
			isNaN(parsedStart) || parsedStart < 1
				? this.rangeStart
				: Math.min(parsedStart, this.constraints.maxRangeStart);
		const end =
			isNaN(parsedEnd) || parsedEnd < start
				? start
				: Math.min(parsedEnd, this.constraints.maxQuestions);

		this.rangeStart = start;
		this.rangeEnd = end;
		this.rangeStartInput = start.toString();
		this.rangeEndInput = end.toString();
		this.notify();
	}

	// Spelling handlers
	setSpellingQuestionCountInput(value: string): void {
		this.spellingQuestionCountInput = value;
		const num = parseInt(value, 10);
		if (!isNaN(num) && num >= 1) {
			this.spellingQuestionCount = Math.min(num, this.constraints.spellingMax);
		}
		this.notify();
	}

	commitSpellingQuestionCount(): void {
		const num = parseInt(this.spellingQuestionCountInput, 10);
		if (isNaN(num) || num < 1) {
			this.spellingQuestionCount = 1;
			this.spellingQuestionCountInput = "1";
		} else {
			const normalized = Math.min(num, this.constraints.spellingMax);
			this.spellingQuestionCount = normalized;
			this.spellingQuestionCountInput = normalized.toString();
		}
		this.notify();
	}

	selectQuickSpellingCount(count: number): void {
		const actual = Math.min(count, this.constraints.spellingMax);
		this.spellingQuestionCount = actual;
		this.spellingQuestionCountInput = actual.toString();
		this.notify();
	}

	setSpellingRangeStartInput(value: string): void {
		this.spellingRangeStartInput = value;
		const num = parseInt(value, 10);
		if (!isNaN(num)) {
			this.spellingRangeStart = Math.max(1, Math.min(num, this.spellingRangeEnd));
		}
		this.notify();
	}

	setSpellingRangeEndInput(value: string): void {
		this.spellingRangeEndInput = value;
		const num = parseInt(value, 10);
		if (!isNaN(num)) {
			this.spellingRangeEnd = Math.max(
				this.spellingRangeStart,
				Math.min(num, this.constraints.spellingMax),
			);
		}
		this.notify();
	}

	commitSpellingRange(): void {
		const parsedStart = parseInt(this.spellingRangeStartInput, 10);
		const parsedEnd = parseInt(this.spellingRangeEndInput, 10);
		const start =
			isNaN(parsedStart) || parsedStart < 1
				? this.spellingRangeStart
				: Math.min(parsedStart, this.constraints.spellingMax);
		const end =
			isNaN(parsedEnd) || parsedEnd < start
				? start
				: Math.min(parsedEnd, this.constraints.spellingMax);

		this.spellingRangeStart = start;
		this.spellingRangeEnd = end;
		this.spellingRangeStartInput = start.toString();
		this.spellingRangeEndInput = end.toString();
		this.notify();
	}

	buildSessionStartRequest(): SessionStartRequest | null {
		const snapshot = this.getSnapshot();
		if (snapshot.isStartDisabled) return null;

		if (this.practiceKind === "spelling") {
			if (this.spellingMode === "range") {
				return {
					mode: "spelling",
					deckId: this.deck.id,
					selection: {
						kind: "range",
						startIndex: this.spellingRangeStart,
						endIndex: this.spellingRangeEnd,
					},
				};
			}
			return {
				mode: "spelling",
				deckId: this.deck.id,
				selection: {
					kind: "smart",
					questionCount: this.spellingQuestionCount,
				},
			};
		}

		// Flip practice
		if (this.selectionMode === "range") {
			this.commitRange();
			if (
				this.rangeEnd >= this.rangeStart &&
				this.rangeEnd <= this.constraints.maxQuestions
			) {
				return {
					mode: "practice",
					deckId: this.deck.id,
					direction: this.direction,
					selection: {
						kind: "range",
						startIndex: this.rangeStart,
						endIndex: this.rangeEnd,
					},
				};
			}
			return null;
		}

		if (this.questionCount >= 1 && this.questionCount <= this.constraints.maxQuestions) {
			return {
				mode: "practice",
				deckId: this.deck.id,
				direction: this.direction,
				selection: {
					kind: "random",
					questionCount: this.questionCount,
				},
			};
		}

		return null;
	}

	startSession(onStartSession: (request: SessionStartRequest) => void): boolean {
		const request = this.buildSessionStartRequest();
		if (!request) return false;
		onStartSession(request);
		return true;
	}
}
