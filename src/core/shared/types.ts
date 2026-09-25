import type { SelectionHelperSettings } from "../selectionHelper/domain/types";
import type { TranslationSettings } from "../../features/translation/domain/types";
import type { DictionarySettings } from "../../features/dictionary/domain/types";
import type { AiSettings } from "../ai/types";
import type { FlashcardStudySettings } from "../../features/flashcards/settings/slice";
import type { HostSettings } from "../settings/hostSlice";
import type { VideoPlayerSettings } from "../../features/video-player/settings/slice";
import { Card } from "ts-fsrs";

export type Language = "zh" | "en";

export type CardDirection = "normal" | "reversed";

export type StudyRating = 1 | 2 | 3 | 4 | 5;

export type PronunciationAccent = "system" | "en-US" | "en-GB";

export type PronunciationRate = "normal" | "slow";

export type OnlinePronunciationProvider = "none" | "azure" | "openai";

export interface PronunciationSettings {
	/** Automatically pronounce a spelling answer after it has been entered correctly. */
	spellingAutoPlay: boolean;
	/** Preferred English accent. System uses the device's default local English voice. */
	accent: PronunciationAccent;
	/** Speaking speed shared by local and online voices. */
	rate: PronunciationRate;
	/** Optional provider used only when no local English voice is installed. */
	onlineProvider: OnlinePronunciationProvider;
	/** Azure public cloud or Azure operated by 21Vianet. */
	azureCloud: "china" | "global";
	/** Azure Speech resource region identifier. */
	azureRegion: string;
	/** SecretStorage ID containing the Azure Speech resource key. */
	azureSecretId: string;
	/** SecretStorage ID containing the OpenAI API key. */
	openaiSecretId: string;
}

/**
 * Per-deck or global study settings
 */
export interface StudySettings {
	/** Daily new cards limit */
	dailyNewCards: number;
	/** Daily review cards limit */
	dailyReviewCards: number;
	/** Study order: sequential or random */
	studyOrder: "sequential" | "random";
	/** FSRS parameters */
	fsrsParameters: {
		requestRetention: number;
		maximumInterval: number;
	};
}

/**
 * Plugin settings.
 *
 * The document is flat on disk and composed of one slice per owner: the host
 * (language), the 闪卡 feature (tags, deck order, study parameters, practice
 * messages), pronunciation, AI engines, AI 翻译, and 词典. Each slice is the
 * authority for its own defaults, normalization, and cloning in
 * `src/settings/settingsSlices.ts`.
 */
export interface FlashcardSettings extends HostSettings, FlashcardStudySettings {
	/** Offline-first word and phrase pronunciation preferences. */
	pronunciation: PronunciationSettings;
	ai: AiSettings;
	translation: TranslationSettings;
	/** Migrated English dictionary tool settings. */
	dictionary: DictionarySettings;
	/** Selection popup helper preferences. */
	selectionPopup: SelectionHelperSettings;
	/** Availability of the desktop local-video feature; paths remain device-local. */
	videoPlayer: VideoPlayerSettings;
}

/**
 * Single flashcard data
 */
export interface FlashCard {
	/** Unique identifier */
	id: string;
	/** Front content (markdown) */
	front: string;
	/** Back content (markdown) */
	back: string;
	/** Optional explanation content (markdown), shown with the answer side */
	explanation?: string;
	/** FSRS card state */
	fsrsCard: Card;
	/** Source file path */
	sourceFile: string;
	/** Index in source file */
	indexInFile: number;
}

/**
 * Deck data structure
 */
export interface Deck {
	/** Deck ID (based on file path) */
	id: string;
	/** Deck name (extracted from file) */
	name: string;
	/** Source file path */
	filePath: string;
	/** Tag associated with this deck */
	tag: string;
	/** All cards in this deck */
	cards: FlashCard[];
	/** Total study sessions count */
	studyCount: number;
	/** Last studied date */
	lastStudied: string | null;
}

/**
 * Study session state
 */
export interface StudySession {
	/** Current deck being studied */
	deckId: string;
	/** Card display direction for this session */
	direction: CardDirection;
	/** Queue of card IDs to study */
	cardQueue: string[];
	/** Current card index in queue */
	currentIndex: number;
	/** Session start time */
	startTime: number;
	/** Cards that need to be repeated in this session */
	repeatQueue: string[];
	/** History of answered cards for "previous" function */
	history: string[];
	/** Answer events used for statistics and true undo */
	answerEvents: StudyAnswerEvent[];
	/** Monotonic count of every submitted rating, including answers later undone */
	attemptCount?: number;
	/** Deck identity and name captured when the session began */
	originDeck?: SessionOriginDeckSnapshot;
	/** Identities removed from the source after their answer events were recorded */
	unavailableCardIds?: string[];
}

export interface SessionOriginDeckSnapshot {
	id: string;
	name: string;
}

/**
 * A single answer event in a study session.
 */
export interface StudyAnswerEvent {
	/** Answered card ID */
	cardId: string;
	/** Learner rating */
	rating: StudyRating;
	/** FSRS state before this answer */
	previousFsrsCard: Card;
	/** FSRS state after this answer */
	nextFsrsCard: Card;
	/** This answer requeues the card in the same session */
	repeatInSession: boolean;
	/** Unix timestamp (ms) when the answer happened */
	answeredAt: number;
	/** Current index before this answer */
	previousCurrentIndex: number;
	/** Card queue length before this answer */
	previousCardQueueLength: number;
	/** Repeat queue before this answer */
	previousRepeatQueue: string[];
}

/**
 * Study statistics for a deck
 */
export interface DeckStats {
	/** Total cards */
	totalCards: number;
	/** New cards (never studied) */
	newCards: number;
	/** Cards due for review */
	dueCards: number;
	/** Cards in learning state */
	learningCards: number;
	/** Cards in review state */
	reviewCards: number;
	/** Cards in relearning state */
	relearningCards: number;
}

/**
 * Rating button configuration
 */
export interface RatingButton {
	/** Button label */
	label: string;
	/** Keyboard shortcut */
	shortcut: string;
	/** Rating value (1-4 for FSRS, 5 for custom "garbage" rating) */
	rating: 1 | 2 | 3 | 4 | 5;
	/** Interval description */
	intervalDesc: string;
}

export type PracticeSelection =
	| { readonly kind: "random"; readonly questionCount: number }
	| { readonly kind: "range"; readonly startIndex: number; readonly endIndex: number }
	| {
			readonly kind: "study-day";
			readonly dayIndex: number;
			readonly studyOrder: StudySettings["studyOrder"];
	  };

export type SpellingSelection =
	| { readonly kind: "smart"; readonly questionCount: number }
	| { readonly kind: "range"; readonly startIndex: number; readonly endIndex: number }
	| { readonly kind: "study-day"; readonly dayIndex: number };

/**
 * View-local setup defaults and navigation state. Active sessions and retained
 * results are represented exclusively by SessionLifecycleSnapshot.
 */
export type ViewState =
	| { type: "home" }
	| {
			type: "study-setup";
			deckId: string;
			initialStudyOrder?: "sequential" | "random";
			initialDirection?: CardDirection;
	  }
	| { type: "word-list"; deckId: string }
	| {
			type: "practice-setup";
			deckId: string;
			initialSelection?: PracticeSelection;
			initialDirection?: CardDirection;
	  }
	| {
			type: "spelling-setup";
			deckId: string;
			initialSelection?: SpellingSelection;
	  }
	| { type: "stats" };

/**
 * A single study history entry (recorded when a session ends)
 */
export interface StudyHistoryEntry {
	/** YYYY-MM-DD local date */
	date: string;
	/** Deck ID */
	deckId: string;
	/** Deck name at time of session */
	deckName: string;
	/** Session mode */
	mode: "study" | "practice" | "spelling" | "word-list";
	/** Cards reviewed (0 for word-list) */
	cardCount: number;
	/** Session duration in seconds */
	duration: number;
	/** Unix timestamp (ms) of session start */
	timestamp: number;
}

/**
 * Info about a single learning day for the day list in StudySetup
 */
export interface StudyDayInfo {
	/** 0-based day index */
	dayIndex: number;
	/** Inclusive start index in sorted cards array */
	startCardIndex: number;
	/** Exclusive end index in sorted cards array */
	endCardIndex: number;
	/** Total cards in this day */
	totalCards: number;
	/** Number of cards already studied (not State.New) */
	studiedCards: number;
	/** All cards in this day have been studied */
	isCompleted: boolean;
	/** This is the first incomplete day */
	isCurrent: boolean;
	/** Day is after the current day — not yet unlocked */
	isLocked: boolean;
}

/**
 * Practice session state (for practice mode without FSRS)
 */
export interface PracticeSession {
	/** Current deck being practiced */
	deckId: string;
	/** Card display direction for this session */
	direction: CardDirection;
	/** Queue of card IDs to practice (randomized) */
	cardQueue: string[];
	/** Current card index in queue */
	currentIndex: number;
	/** Session start time */
	startTime: number;
	/** Total number of questions selected */
	totalQuestions: number;
	/** Record of user answers: cardId -> isCorrect */
	answers: Record<string, boolean>;
	/** Answered-card history for the previous-card function */
	history: string[];
	/** Monotonic count of every submitted answer, including answers later revisited */
	attemptCount?: number;
	/** Deck identity and name captured when the session began */
	originDeck?: SessionOriginDeckSnapshot;
	/** Identities removed from the source after their answer events were recorded */
	unavailableCardIds?: string[];
}

/**
 * Practice result for summary display
 */
export interface PracticeResult {
	/** Card display direction used for this practice run */
	direction: CardDirection;
	/** Total questions answered */
	totalQuestions: number;
	/** Number of correct answers */
	correctCount: number;
	/** Number of incorrect answers */
	incorrectCount: number;
	/** Accuracy percentage */
	accuracy: number;
	/** List of incorrectly answered card IDs */
	incorrectCardIds: string[];
	/** Total time spent (in seconds) */
	timeSpent: number;
}

/**
 * Persisted spelling performance for one stable card identity.
 * Forced correction attempts are intentionally excluded.
 */
export interface SpellingCardProgress {
	attempts: number;
	correctAttempts: number;
	correctStreak: number;
	lastAttemptAt: number;
	lastIncorrectAt?: number;
}

export type SpellingSessionPhase = "retrieval" | "correction";

export interface SpellingFirstAttempt {
	input: string;
	correct: boolean;
	answeredAt: number;
}

export interface SpellingAttemptEvent {
	cardId: string;
	input: string;
	correct: boolean;
	kind: SpellingSessionPhase;
	answeredAt: number;
}

/**
 * Active spelling session. Wrong retrievals append the card to the queue and
 * keep the current position in correction phase until the answer is retyped.
 */
export interface SpellingSession {
	deckId: string;
	selectedCardIds: string[];
	cardQueue: string[];
	currentIndex: number;
	startTime: number;
	phase: SpellingSessionPhase;
	firstAttempts: Record<string, SpellingFirstAttempt>;
	attempts: SpellingAttemptEvent[];
	completedCardIds: string[];
	originDeck?: SessionOriginDeckSnapshot;
	unavailableCardIds?: string[];
}

export interface SpellingResult {
	totalWords: number;
	firstTryCorrectCount: number;
	firstTryIncorrectCount: number;
	firstTryAccuracy: number;
	totalRetrievalAttempts: number;
	incorrectCardIds: string[];
	firstInputs: Record<string, string>;
	timeSpent: number;
}

/**
 * Card state after rating
 */
export interface CardRatingResult {
	card: FlashCard;
	repeatInSession: boolean;
}
