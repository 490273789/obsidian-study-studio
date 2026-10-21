import React, {
	useCallback,
	useLayoutEffect,
	useMemo,
	useId,
	useRef,
	useSyncExternalStore,
} from "react";
import { App, Component, MarkdownRenderer, Notice, TFile } from "obsidian";
import type { ScopedWorkbenchSettings } from "../../../core/host/settingsSlices";
import type { WorkbenchFeatureShortcut } from "../../../core/host/workbench";
import type { DeckHome, DeckHomeDestination } from "../domain/decks/deckHome";
import { type SessionLifecycle } from "../domain/sessions/sessionLifecycle";
import type { FlashcardLearningActivityPort } from "../domain/storage/flashcardPersistence";
import { CardEditorModal } from "./views/Card";
import { createTranslator } from "../strings/index";
import { ConfirmDialog } from "../../../core/ui/primitives/ConfirmDialog";
import type { CardIdentityContinuity } from "../domain/identity/cardIdentityContinuity";
import { CardEditingInteraction } from "./cardEditingInteraction";
import type { PronunciationRuntime } from "../domain/pronunciation";
import { ModalProvider } from "../../../core/ui/primitives/Modal";
import { createAnswerPresentationTransition } from "./answerPresentationTransition";
import { FlashcardNavigation } from "./flashcardNavigation";
import { PageTransitionTracker } from "./pageTransition";
import { resolvePage, type FlashcardPageContext } from "./routes";
import { InputVisibilityProvider } from "./hooks/useSessionInputVisibility";
import { CardPresentationProvider } from "./presentation/context";
import styles from "./FlashcardApp.module.scss";

interface FlashcardAppProps {
	app: App;
	modalHost: HTMLElement;
	sessionLifecycle: SessionLifecycle;
	cardIdentityContinuity: CardIdentityContinuity;
	pronunciationRuntime: PronunciationRuntime;
	deckHome: DeckHome;
	learningActivity?: FlashcardLearningActivityPort;
	settings: ScopedWorkbenchSettings<"flashcards">;
	shortcuts: readonly WorkbenchFeatureShortcut[];
	onOpenSettings: () => void;
}

export const FlashcardApp: React.FC<FlashcardAppProps> = ({
	app,
	modalHost,
	cardIdentityContinuity,
	sessionLifecycle,
	pronunciationRuntime,
	deckHome,
	learningActivity,
	settings,
	shortcuts,
	onOpenSettings,
}) => {
	const deckHomeOwnerId = useId();
	const t = useMemo(() => createTranslator(settings.language), [settings.language]);

	const navigation = useMemo(
		() =>
			new FlashcardNavigation({
				lifecycle: sessionLifecycle,
				home: deckHome,
				ownerId: deckHomeOwnerId,
				notify: (message) => {
					new Notice(message);
				},
			}),
		[sessionLifecycle, deckHome, deckHomeOwnerId],
	);
	useLayoutEffect(
		() => navigation.setLanguage(settings.language),
		[navigation, settings.language],
	);
	useLayoutEffect(() => navigation.mount(), [navigation]);
	const {
		view: viewState,
		confirmation,
		busy: navigationBusy,
	} = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot);
	const handleRequestHomeMigration = navigation.requestMigration;
	const handleStartSession = navigation.start;
	const handleBackHome = navigation.home;
	const handleOpenStats = navigation.stats;
	const handleSessionComplete = navigation.home;
	const answerPresentationTransition = useMemo(
		() =>
			createAnswerPresentationTransition({
				lifecycle: sessionLifecycle,
				pronunciationRuntime,
				notify: (message) => {
					new Notice(message);
				},
			}),
		[pronunciationRuntime, sessionLifecycle],
	);
	useLayoutEffect(() => {
		answerPresentationTransition.setWordLearningDecks(settings.wordLearningDecks);
	}, [answerPresentationTransition, settings.wordLearningDecks]);
	const subscribeAnswerPresentation = useCallback(
		(listener: () => void) => answerPresentationTransition.subscribe(listener),
		[answerPresentationTransition],
	);
	const readAnswerPresentation = useCallback(
		() => answerPresentationTransition.getSnapshot(),
		[answerPresentationTransition],
	);
	const answerPresentationSnapshot = useSyncExternalStore(
		subscribeAnswerPresentation,
		readAnswerPresentation,
		readAnswerPresentation,
	);
	const presentedLifecycleSnapshot = answerPresentationSnapshot.lifecycle;
	const presentedCard = answerPresentationSnapshot.presentedCard;
	const isAnswerTransitioning = answerPresentationSnapshot.activity.kind === "transitioning";
	const cardEditing = useMemo(
		() =>
			new CardEditingInteraction({
				continuity: cardIdentityContinuity,
				navigation,
				notify: (message) => {
					new Notice(message);
				},
			}),
		[cardIdentityContinuity, navigation],
	);
	useLayoutEffect(
		() => cardEditing.setLanguage(settings.language),
		[cardEditing, settings.language],
	);
	useLayoutEffect(() => cardEditing.mount(), [cardEditing]);
	const { editor: cardEditor } = useSyncExternalStore(
		cardEditing.subscribe,
		cardEditing.getSnapshot,
	);

	const renderMarkdown = useCallback(
		async (content: string, el: HTMLElement, component?: Component): Promise<void> => {
			await MarkdownRenderer.render(app, content, el, "", component ?? new Component());
		},
		[app],
	);

	// Keep one callback identity per word-list deck so the memoized WordListView
	// keeps its props when an unrelated deck-home revision re-renders this app.
	const wordListDeckId = viewState.type === "word-list" ? viewState.deckId : null;
	const handleRecordWordListVisit = useCallback(
		(startTimeMs: number, endTimeMs: number) => {
			if (wordListDeckId === null || !learningActivity) return;
			const deckName = deckHome.getDeck(wordListDeckId)?.name ?? wordListDeckId;
			void learningActivity.recordWordListVisit(
				wordListDeckId,
				deckName,
				startTimeMs,
				endTimeMs,
			);
		},
		[learningActivity, deckHome, wordListDeckId],
	);

	const handleOpenAddCard = useCallback(() => {
		cardEditing.openCreate(deckHome.getSnapshot().decks[0]?.id ?? null);
	}, [cardEditing, deckHome]);

	const handleConfirmDialogConfirm = useCallback(() => {
		if (confirmation) navigation.respond(confirmation.id, true);
	}, [navigation, confirmation]);
	const handleConfirmDialogCancel = useCallback(() => {
		if (confirmation) navigation.respond(confirmation.id, false);
	}, [navigation, confirmation]);

	const handleOpenEditCard = useCallback(
		(deckId: string, cardId: string) => {
			void cardEditing.openEdit(deckId, cardId);
		},
		[cardEditing],
	);

	const handleHomeNavigate = useCallback(
		(destination: DeckHomeDestination, deckId: string) => {
			void navigation.navigate(destination, deckId);
		},
		[navigation],
	);
	const handleExitActive = useCallback(() => {
		if (presentedLifecycleSnapshot.kind === "active")
			void navigation.exit(presentedLifecycleSnapshot.reference);
	}, [navigation, presentedLifecycleSnapshot]);
	const handlePracticeRestart = useCallback(() => {
		if (presentedLifecycleSnapshot.kind === "result")
			void navigation.result(presentedLifecycleSnapshot.reference, "restart");
	}, [navigation, presentedLifecycleSnapshot]);
	const handlePracticeRetryIncorrect = useCallback(() => {
		if (presentedLifecycleSnapshot.kind === "result")
			void navigation.result(presentedLifecycleSnapshot.reference, "retry-incorrect");
	}, [navigation, presentedLifecycleSnapshot]);
	const handleResultHomeClick = useCallback(() => {
		if (presentedLifecycleSnapshot.kind === "result")
			void navigation.result(presentedLifecycleSnapshot.reference, "home");
	}, [navigation, presentedLifecycleSnapshot]);
	const handleNextLevel = useCallback(() => {
		if (presentedLifecycleSnapshot.kind === "result")
			void navigation.result(presentedLifecycleSnapshot.reference, "next-level");
	}, [navigation, presentedLifecycleSnapshot]);

	const handleDeleteCardRequest = useCallback(
		(deckId: string, cardId: string) => {
			void cardEditing.delete(deckId, cardId);
		},
		[cardEditing],
	);

	const handleOpenSourceFile = useCallback(
		(filePath: string) => {
			const file = app.vault.getAbstractFileByPath(filePath);
			if (file instanceof TFile) {
				void app.workspace.getLeaf(false).openFile(file);
			} else {
				new Notice(t("notice.sourceMissing", { filePath }));
			}
		},
		[app, t],
	);

	const pageContext: FlashcardPageContext = {
		deckHome,
		deckHomeOwnerId,
		shortcuts,
		wordLearningDecks: settings.wordLearningDecks,
		transition: answerPresentationTransition,
		presentedCard,
		cardPresentation: answerPresentationSnapshot.cardPresentation,
		isAnswerTransitioning,
		cardMotion: answerPresentationSnapshot.cardMotion,
		spellingFeedback: answerPresentationSnapshot.spellingFeedback,
		isNavigationBusy: navigationBusy,
		language: settings.language,
		markdownRenderer: renderMarkdown,
		onOpenSettings,
		onStartSession: handleStartSession,
		onBackHome: handleBackHome,
		onOpenStats: handleOpenStats,
		onHomeNavigate: handleHomeNavigate,
		onRequestMigration: handleRequestHomeMigration,
		onOpenSourceFile: handleOpenSourceFile,
		onOpenAddCard: handleOpenAddCard,
		onOpenChallenge: navigation.challenge,
		onEditCard: handleOpenEditCard,
		onDeleteCard: handleDeleteCardRequest,
		onCloseActive: handleExitActive,
		onComplete: handleSessionComplete,
		onRestart: handlePracticeRestart,
		onRetryIncorrect: handlePracticeRetryIncorrect,
		onResultHome: handleResultHomeClick,
		onNextLevel: handleNextLevel,
		onStartChallenge: (request, replaceExisting) => {
			void navigation.startChallenge(request, replaceExisting);
		},
		onRecordWordListVisit: handleRecordWordListVisit,
	};

	const page = resolvePage({
		viewState,
		lifecycle: presentedLifecycleSnapshot,
		presentedCard,
		deckHome,
	});

	// Only page changes restart the animation. Card progress, settings updates,
	// and the challenge setup overlay keep the current page (and its local state).
	const pageTransitionTracker = useMemo(() => new PageTransitionTracker(), []);
	const pageTransition = pageTransitionTracker.resolve(page);
	const pageTransitionRef = useRef<HTMLDivElement | null>(null);

	// The CSS entrance starts when the keyed page is inserted. If the commit runs
	// heavy layout work afterwards, the first painted frame can already be near
	// the end of the animation, which reads as "no animation" at all. Rewinding
	// the animation in the last layout effect keeps the whole entrance visible.
	useLayoutEffect(() => {
		for (const animation of pageTransitionRef.current?.getAnimations?.() ?? []) {
			animation.currentTime = 0;
			animation.play();
		}
	}, [pageTransition.key]);

	return (
		<InputVisibilityProvider host={modalHost}>
			<ModalProvider host={modalHost}>
				<CardPresentationProvider
					markdownRenderer={renderMarkdown}
					pronunciationRuntime={pronunciationRuntime}
				>
					<div
						key={pageTransition.key}
						ref={pageTransitionRef}
						className={styles.pageTransition}
						data-page={pageTransition.key}
						data-direction={pageTransition.direction}
					>
						{page.render(pageContext)}
					</div>
					{cardEditor && (
						<CardEditorModal
							key={cardEditor.id}
							mode={cardEditor.mode}
							decks={deckHome.getSnapshot().decks}
							initialDeckId={cardEditor.deckId}
							initialFront={cardEditor.front}
							initialBack={cardEditor.back}
							initialExplanation={cardEditor.explanation}
							isSaving={cardEditor.saving}
							error={cardEditor.error}
							onSave={(draft) => cardEditing.save(cardEditor.id, draft)}
							onClose={() => cardEditing.close(cardEditor.id)}
						/>
					)}
					{confirmation && (
						<ConfirmDialog
							key={confirmation.id}
							title={confirmation.title}
							message={confirmation.message}
							confirmText={confirmation.confirmText}
							cancelText={t("common.cancel")}
							kicker={t("common.confirmAction")}
							tone={confirmation.tone}
							onConfirm={handleConfirmDialogConfirm}
							onCancel={handleConfirmDialogCancel}
						/>
					)}
				</CardPresentationProvider>
			</ModalProvider>
		</InputVisibilityProvider>
	);
};
