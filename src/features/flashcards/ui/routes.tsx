import React from "react";
import type { WorkbenchFeatureShortcut } from "../../../core/host/workbench";
import type {
	CardDirection,
	Language,
	PracticeSelection,
	SpellingSelection,
} from "../../../core/shared/types";
import type { DeckHome, DeckHomeDestination } from "../domain/decks/deckHome";
import type { DeckSettingsDraftSession } from "../domain/decks/deckSettingsDraftSession";
import type {
	ActiveChallengeSnapshot,
	ActivePracticeSnapshot,
	ActiveSpellingSnapshot,
	ActiveStudySnapshot,
	ChallengeResultSnapshot,
	PracticeResultSnapshot,
	SessionLifecycleSnapshot,
	SessionRestartOrigin,
	SessionStartRequest,
	SpellingLifecycleFeedback,
	SpellingResultSnapshot,
	StudyResultSnapshot,
} from "../domain/sessions/sessionLifecycle";
import type {
	AnswerPresentationTransition,
	CardMotion,
	CardPresentationSnapshot,
	PresentedCard,
} from "./answerPresentationTransition";
import { ChallengeSetupModal, ChallengeSummary, ChallengeView } from "./views/Challenge";
import { CardView } from "./views/Card";
import { DeckHomeSnapshotRoute, HomeRoute } from "./views/Home/HomeRoute";
import { PracticeSetup, PracticeSummary, PracticeView } from "./views/Practice";
import { SpellingSetup, SpellingSummary, SpellingView } from "./views/Spelling";
import { StatsView } from "./views/Stats";
import { StudySetup, StudySummary } from "./views/Study";
import { WordListView } from "./views/WordList";

/** A non-session page the flashcard navigation can rest on. */
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
	| { type: "challenge-setup" }
	| { type: "stats" };

export function home(): ViewState {
	return Object.freeze({ type: "home" });
}

export function stats(): ViewState {
	return Object.freeze({ type: "stats" });
}

export function challengeSetup(): ViewState {
	return Object.freeze({ type: "challenge-setup" });
}

export function studySetup(
	deckId: string,
	options: {
		readonly initialStudyOrder?: "sequential" | "random";
		readonly initialDirection?: CardDirection;
	} = {},
): ViewState {
	return Object.freeze({
		type: "study-setup",
		deckId,
		...(options.initialStudyOrder ? { initialStudyOrder: options.initialStudyOrder } : {}),
		...(options.initialDirection ? { initialDirection: options.initialDirection } : {}),
	});
}

export function practiceSetup(
	deckId: string,
	options: {
		readonly initialSelection?: PracticeSelection;
		readonly initialDirection?: CardDirection;
	} = {},
): ViewState {
	return Object.freeze({
		type: "practice-setup",
		deckId,
		...(options.initialSelection
			? { initialSelection: Object.freeze({ ...options.initialSelection }) }
			: {}),
		...(options.initialDirection ? { initialDirection: options.initialDirection } : {}),
	});
}

export function spellingSetup(
	deckId: string,
	options: { readonly initialSelection?: SpellingSelection } = {},
): ViewState {
	return Object.freeze({
		type: "spelling-setup",
		deckId,
		...(options.initialSelection
			? { initialSelection: Object.freeze({ ...options.initialSelection }) }
			: {}),
	});
}

export function wordList(deckId: string): ViewState {
	return Object.freeze({ type: "word-list", deckId });
}

/** Maps domain restart provenance onto the route vocabulary owned by navigation. */
export function fromRestartOrigin(origin: SessionRestartOrigin): ViewState {
	if (origin.mode === "challenge") return challengeSetup();
	if (origin.mode === "study") {
		return studySetup(origin.deckId, {
			initialStudyOrder: origin.studyOrder,
			initialDirection: origin.direction,
		});
	}
	if (origin.selection.kind === "study-day") {
		return origin.mode === "practice"
			? studySetup(origin.deckId, {
					initialStudyOrder: origin.selection.studyOrder,
					initialDirection: origin.direction,
				})
			: studySetup(origin.deckId);
	}
	if (origin.mode === "practice") {
		return practiceSetup(origin.deckId, {
			initialSelection: origin.selection,
			initialDirection: origin.direction,
		});
	}
	return spellingSetup(origin.deckId, { initialSelection: origin.selection });
}

/** The shell-owned actions and snapshots route pages receive. */
export interface FlashcardPageContext {
	readonly deckHome: DeckHome;
	readonly deckHomeOwnerId: string;
	readonly deckSettingsDraftSession?: DeckSettingsDraftSession;
	readonly shortcuts: readonly WorkbenchFeatureShortcut[];
	readonly wordLearningDecks: Readonly<Record<string, boolean>>;
	readonly transition: AnswerPresentationTransition;
	readonly presentedCard: PresentedCard | null;
	readonly cardPresentation: CardPresentationSnapshot;
	readonly isAnswerTransitioning: boolean;
	readonly cardMotion: CardMotion;
	readonly spellingFeedback: Readonly<SpellingLifecycleFeedback> | null;
	readonly isNavigationBusy: boolean;
	readonly language: Language;
	readonly markdownRenderer: (content: string, el: HTMLElement) => Promise<void>;
	readonly onOpenSettings: () => void;
	readonly onStartSession: (request: SessionStartRequest) => void;
	readonly onBackHome: () => void;
	readonly onOpenStats: () => void;
	readonly onHomeNavigate: (destination: DeckHomeDestination, deckId: string) => void;
	readonly onRequestMigration: (deckId?: string) => Promise<boolean>;
	readonly onOpenSourceFile: (path: string) => void;
	readonly onOpenAddCard: () => void;
	readonly onOpenChallenge: () => void;
	readonly onEditCard: (deckId: string, cardId: string) => void;
	readonly onDeleteCard: (deckId: string, cardId: string) => void;
	readonly onCloseActive: () => void;
	readonly onComplete: () => void;
	readonly onRestart: () => void;
	readonly onRetryIncorrect: () => void;
	readonly onResultHome: () => void;
	readonly onNextLevel: () => void;
	readonly onStartChallenge: (
		request: Extract<SessionStartRequest, { mode: "challenge" }>,
		replaceExisting: boolean,
	) => void;
	readonly onRecordWordListVisit: (startTimeMs: number, endTimeMs: number) => void;
}

/** A resolved page: identity, depth, and the node the shell should render. */
interface ResolvedPage {
	readonly key: string;
	readonly depth: number;
	render(context: FlashcardPageContext): React.ReactNode;
}

const HOME_PAGE: ResolvedPage = Object.freeze({
	key: "home",
	depth: 0,
	render: (context: FlashcardPageContext) => renderHome(context),
});

const SESSION_DEPTH = 2;

function page(key: string, depth: number, render: ResolvedPage["render"]): ResolvedPage {
	return Object.freeze({ key, depth, render });
}

interface ResolvePageInput {
	readonly viewState: Readonly<ViewState>;
	readonly lifecycle: SessionLifecycleSnapshot;
	readonly presentedCard: PresentedCard | null;
	readonly deckHome: DeckHome;
}

/** Resolves the one page identity and content pair; data-missing falls back to home. */
export function resolvePage(input: ResolvePageInput): ResolvedPage {
	const { lifecycle, presentedCard, deckHome } = input;
	if (lifecycle.kind === "active") {
		if (!presentedCard) return HOME_PAGE;
		return resolveActivePage(lifecycle, presentedCard);
	}
	if (lifecycle.kind === "result") {
		return resolveResultPage(lifecycle);
	}
	return resolveViewState(input.viewState, deckHome);
}

function resolveActivePage(
	session:
		| ActiveStudySnapshot
		| ActivePracticeSnapshot
		| ActiveSpellingSnapshot
		| ActiveChallengeSnapshot,
	presentedCard: PresentedCard,
): ResolvedPage {
	const key = `active:${session.mode}`;
	if (session.mode === "study") {
		return page(key, SESSION_DEPTH, (context) => (
			<CardView
				session={session}
				presentedCard={presentedCard}
				transition={context.transition}
				isTransitioning={context.isAnswerTransitioning}
				cardMotion={context.cardMotion}
				onComplete={context.onComplete}
				onEditCard={context.onEditCard}
				onDeleteCard={context.onDeleteCard}
				onClose={context.onCloseActive}
				cardPresentation={context.cardPresentation}
			/>
		));
	}
	if (session.mode === "practice") {
		return page(key, SESSION_DEPTH, (context) => (
			<PracticeView
				session={session}
				presentedCard={presentedCard}
				transition={context.transition}
				isTransitioning={context.isAnswerTransitioning}
				cardMotion={context.cardMotion}
				onEditCard={context.onEditCard}
				onDeleteCard={context.onDeleteCard}
				onClose={context.onCloseActive}
				cardPresentation={context.cardPresentation}
			/>
		));
	}
	if (session.mode === "spelling") {
		return page(key, SESSION_DEPTH, (context) => (
			<SpellingView
				session={session}
				presentedCard={presentedCard}
				transition={context.transition}
				isTransitioning={context.isAnswerTransitioning}
				cardMotion={context.cardMotion}
				feedback={context.spellingFeedback}
				onEditCard={context.onEditCard}
				onDeleteCard={context.onDeleteCard}
				onClose={context.onCloseActive}
			/>
		));
	}
	if (session.mode === "challenge") {
		return page(key, SESSION_DEPTH, (context) => (
			<ChallengeView
				session={session}
				presentedCard={presentedCard}
				transition={context.transition}
				isTransitioning={context.isAnswerTransitioning}
				cardMotion={context.cardMotion}
				onClose={context.onCloseActive}
			/>
		));
	}
	const unhandledMode: never = session;
	return unhandledMode;
}

function resolveResultPage(
	result:
		| StudyResultSnapshot
		| PracticeResultSnapshot
		| SpellingResultSnapshot
		| ChallengeResultSnapshot,
): ResolvedPage {
	const key = `result:${result.mode}`;
	if (result.mode === "study") {
		return page(key, SESSION_DEPTH, (context) => (
			<StudySummary
				result={result}
				onHome={context.onResultHome}
				onRestart={context.onRestart}
			/>
		));
	}
	if (result.mode === "practice") {
		return page(key, SESSION_DEPTH, (context) => (
			<PracticeSummary
				result={result}
				onRestart={context.onRestart}
				onPracticeIncorrect={context.onRetryIncorrect}
				onHome={context.onResultHome}
				markdownRenderer={context.markdownRenderer}
			/>
		));
	}
	if (result.mode === "spelling") {
		return page(key, SESSION_DEPTH, (context) => (
			<SpellingSummary
				result={result}
				onRetryIncorrect={context.onRetryIncorrect}
				onRestart={context.onRestart}
				onHome={context.onResultHome}
				markdownRenderer={context.markdownRenderer}
			/>
		));
	}
	if (result.mode === "challenge") {
		return page(key, SESSION_DEPTH, (context) => (
			<ChallengeSummary
				result={result}
				onNextLevel={context.onNextLevel}
				onRestart={context.onRestart}
				onEnd={context.onResultHome}
				markdownRenderer={context.markdownRenderer}
			/>
		));
	}
	const unhandledMode: never = result;
	return unhandledMode;
}

function resolveViewState(viewState: Readonly<ViewState>, deckHome: DeckHome): ResolvedPage {
	switch (viewState.type) {
		case "home":
			return HOME_PAGE;
		case "challenge-setup":
			return page("home", 0, (context) => (
				<>
					{renderHome(context)}
					<DeckHomeSnapshotRoute home={context.deckHome}>
						{(snapshot) => (
							<ChallengeSetupModal
								readiness={snapshot.challenge}
								isStarting={context.isNavigationBusy}
								onStart={(challengeMode, intent) =>
									context.onStartChallenge(
										{
											mode: "challenge",
											challengeMode,
											intent,
											expectedRoundId: snapshot.challenge.savedRoundId,
										},
										snapshot.challenge.round !== null,
									)
								}
								onClose={context.onBackHome}
							/>
						)}
					</DeckHomeSnapshotRoute>
				</>
			));
		case "stats":
			return page("stats", 1, (context) => (
				<DeckHomeSnapshotRoute home={context.deckHome}>
					{(snapshot) => (
						<StatsView history={snapshot.studyHistory} onBack={context.onBackHome} />
					)}
				</DeckHomeSnapshotRoute>
			));
		case "word-list": {
			const deck = deckHome.getDeck(viewState.deckId);
			if (!deck) return HOME_PAGE;
			return page(`word-list:${viewState.deckId}`, 1, (context) => (
				<WordListView
					key={deck.id}
					deck={deck}
					onBack={context.onBackHome}
					onRecordVisit={context.onRecordWordListVisit}
				/>
			));
		}
		case "study-setup": {
			const deck = deckHome.getDeck(viewState.deckId);
			if (!deck) return HOME_PAGE;
			const plan = deckHome.getStudySetupPlan(deck.id, viewState.initialStudyOrder);
			if (!plan) return HOME_PAGE;
			return page(`study-setup:${viewState.deckId}`, 1, (context) => (
				<DeckHomeSnapshotRoute home={context.deckHome}>
					{() => {
						const currentPlan = context.deckHome.getStudySetupPlan(
							deck.id,
							viewState.initialStudyOrder,
						);
						if (!currentPlan) return renderHome(context);
						return (
							<StudySetup
								key={deck.id}
								deck={deck}
								plan={currentPlan}
								defaultDirection={viewState.initialDirection ?? "normal"}
								spellingEnabled={Boolean(
									context.wordLearningDecks[viewState.deckId],
								)}
								onStartSession={context.onStartSession}
								onBack={context.onBackHome}
							/>
						);
					}}
				</DeckHomeSnapshotRoute>
			));
		}
		case "practice-setup": {
			const deck = deckHome.getDeck(viewState.deckId);
			if (!deck) return HOME_PAGE;
			const plan = deckHome.getPracticeSetupPlan(deck.id, viewState.initialSelection);
			if (!plan) return HOME_PAGE;
			return page(`practice-setup:${viewState.deckId}`, 1, (context) => (
				<PracticeSetup
					key={deck.id}
					deck={deck}
					plan={plan}
					defaultDirection={viewState.initialDirection ?? "normal"}
					initialDirection={viewState.initialDirection}
					onStartSession={context.onStartSession}
					onBack={context.onBackHome}
				/>
			));
		}
		case "spelling-setup": {
			const deck = deckHome.getDeck(viewState.deckId);
			if (!deck) return HOME_PAGE;
			const plan = deckHome.getSpellingSetupPlan(deck.id, viewState.initialSelection);
			if (!plan) return HOME_PAGE;
			return page(`spelling-setup:${viewState.deckId}`, 1, (context) => (
				<DeckHomeSnapshotRoute home={context.deckHome}>
					{() => {
						const currentPlan = context.deckHome.getSpellingSetupPlan(
							deck.id,
							viewState.initialSelection,
						);
						if (!currentPlan) return renderHome(context);
						return (
							<SpellingSetup
								key={deck.id}
								deck={deck}
								plan={currentPlan}
								onStartSession={context.onStartSession}
								onBack={context.onBackHome}
							/>
						);
					}}
				</DeckHomeSnapshotRoute>
			));
		}
	}
	const unhandledRoute: never = viewState;
	return unhandledRoute;
}

function renderHome(context: FlashcardPageContext): React.ReactNode {
	return (
		<HomeRoute
			home={context.deckHome}
			ownerId={context.deckHomeOwnerId}
			settingsDraftSession={context.deckSettingsDraftSession}
			onNavigate={context.onHomeNavigate}
			onRequestMigration={context.onRequestMigration}
			onOpenSourceFile={context.onOpenSourceFile}
			onOpenStats={context.onOpenStats}
			onOpenSettings={context.onOpenSettings}
			onOpenAddCard={context.onOpenAddCard}
			onOpenChallenge={context.onOpenChallenge}
			shortcuts={context.shortcuts}
		/>
	);
}
