import React, {
	useState,
	useCallback,
	useLayoutEffect,
	useMemo,
	useEffect,
	useId,
	useSyncExternalStore,
} from "react";
import { App, Component, MarkdownRenderer, Notice, TFile } from "obsidian";
import type { ScopedWorkbenchSettings } from "../../../core/host/settingsSlices";
import type { DeckHome, DeckHomeDestination } from "../domain/decks/deckHome";
import { type SessionLifecycle } from "../domain/sessions/sessionLifecycle";
import {
	getStudySetupPlan,
	getPracticeSetupPlan,
	getSpellingSetupPlan,
} from "../domain/sessions/sessionPlanner";
import { DeckList } from "./views/Home";
import { CardView, CardEditorModal, type CardEditorSavePayload } from "./views/Card";
import { PracticeSetup, PracticeView, PracticeSummary } from "./views/Practice";
import { WordListView } from "./views/WordList";
import { StudySetup, StudySummary } from "./views/Study";
import { StatsView } from "./views/Stats";
import { SpellingSetup, SpellingView, SpellingSummary } from "./views/Spelling";
import { createTranslator } from "../strings/index";
import { ConfirmDialog } from "../../../core/ui/primitives/ConfirmDialog";
import type { CardIdentityContinuity } from "../domain/identity/cardIdentityContinuity";
import {
	executeCardMutationWorkflow,
	type CardMutationRequest,
} from "../domain/identity/cardMutationWorkflow";
import type { PronunciationRuntime } from "../domain/pronunciation";
import { ModalProvider } from "../../../core/ui/primitives/Modal";
import { createAnswerPresentationTransition } from "./answerPresentationTransition";
import { FlashcardNavigation } from "./flashcardNavigation";

interface FlashcardAppProps {
	app: App;
	modalHost: HTMLElement;
	sessionLifecycle: SessionLifecycle;
	cardIdentityContinuity: CardIdentityContinuity;
	pronunciationRuntime: PronunciationRuntime;
	deckHome: DeckHome;
	settings: ScopedWorkbenchSettings<"flashcards">;
	onOpenSettings: () => void;
	onOpenTranslation?: () => void;
	onOpenDictionary?: () => void;
	onOpenVideoPlayer?: () => void;
}

type CardEditorState =
	| {
			mode: "create";
			deckId: string | null;
	  }
	| {
			mode: "edit";
			deckId: string;
			cardId: string;
			front: string;
			back: string;
			explanation: string;
	  };

export const FlashcardApp: React.FC<FlashcardAppProps> = ({
	app,
	modalHost,
	cardIdentityContinuity,
	sessionLifecycle,
	pronunciationRuntime,
	deckHome,
	settings,
	onOpenSettings,
	onOpenTranslation,
	onOpenDictionary,
	onOpenVideoPlayer,
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
	const { view: viewState, confirmation } = useSyncExternalStore(
		navigation.subscribe,
		navigation.getSnapshot,
	);
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
			}),
		[pronunciationRuntime, sessionLifecycle],
	);
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
	const isAnswerTransitioning = answerPresentationSnapshot.activity.kind === "transitioning";
	const subscribeDeckHome = useCallback(
		(listener: () => void) => deckHome.subscribe(listener),
		[deckHome],
	);
	const readDeckHomeSnapshot = useCallback(() => deckHome.getSnapshot(), [deckHome]);
	const deckHomeSnapshot = useSyncExternalStore(
		subscribeDeckHome,
		readDeckHomeSnapshot,
		readDeckHomeSnapshot,
	);

	// Mobile/iPad: prevent iOS WebKit from scrolling window/document when focusing inputs
	useEffect(() => {
		const ownerWindow = modalHost.ownerDocument.defaultView ?? window;
		const ownerDoc = modalHost.ownerDocument;

		const resetWindowScroll = () => {
			if (ownerWindow.scrollY > 0 || ownerWindow.scrollX > 0) {
				ownerWindow.scrollTo({ top: 0, left: 0, behavior: "instant" });
			}
			if (ownerDoc.body && ownerDoc.body.scrollTop > 0) {
				ownerDoc.body.scrollTop = 0;
			}
			if (ownerDoc.documentElement && ownerDoc.documentElement.scrollTop > 0) {
				ownerDoc.documentElement.scrollTop = 0;
			}
		};

		const handleFocusIn = (event: FocusEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.tagName === "SELECT")
			) {
				ownerWindow.requestAnimationFrame(resetWindowScroll);
				ownerWindow.setTimeout(resetWindowScroll, 50);
				ownerWindow.setTimeout(resetWindowScroll, 200);
			}
		};

		const handleFocusOut = () => {
			ownerWindow.requestAnimationFrame(resetWindowScroll);
		};

		ownerWindow.addEventListener("scroll", resetWindowScroll, { passive: true });
		ownerDoc.addEventListener("focusin", handleFocusIn);
		ownerDoc.addEventListener("focusout", handleFocusOut);

		const viewport = ownerWindow.visualViewport;
		viewport?.addEventListener("resize", resetWindowScroll);
		viewport?.addEventListener("scroll", resetWindowScroll);

		return () => {
			ownerWindow.removeEventListener("scroll", resetWindowScroll);
			ownerDoc.removeEventListener("focusin", handleFocusIn);
			ownerDoc.removeEventListener("focusout", handleFocusOut);
			viewport?.removeEventListener("resize", resetWindowScroll);
			viewport?.removeEventListener("scroll", resetWindowScroll);
		};
	}, [modalHost]);

	const [cardEditor, setCardEditor] = useState<CardEditorState | null>(null);

	const renderMarkdown = useCallback(
		async (content: string, el: HTMLElement, component?: Component): Promise<void> => {
			await MarkdownRenderer.render(app, content, el, "", component ?? new Component());
		},
		[app],
	);

	const handleRecordWordListVisit = useCallback(
		(deckId: string, startTimeMs: number, endTimeMs: number) => {
			void deckHome.recordWordListVisit(deckId, startTimeMs, endTimeMs);
		},
		[deckHome],
	);

	const handleOpenAddCard = useCallback(() => {
		const firstDeck = deckHomeSnapshot.decks[0];
		if (!firstDeck) {
			new Notice(t("notice.noDecks"));
			return;
		}
		setCardEditor({
			mode: "create",
			deckId: firstDeck.id,
		});
	}, [deckHomeSnapshot.decks, t]);

	const handleCloseCardEditor = useCallback(() => {
		setCardEditor(null);
	}, []);

	const handleConfirmDialogConfirm = useCallback(() => {
		if (confirmation) navigation.respond(confirmation.id, true);
	}, [navigation, confirmation]);
	const handleConfirmDialogCancel = useCallback(() => {
		if (confirmation) navigation.respond(confirmation.id, false);
	}, [navigation, confirmation]);

	const handleOpenEditCard = useCallback(
		(deckId: string, cardId: string) => {
			void (async () => {
				const preparation = await cardIdentityContinuity.prepareEdit(deckId, cardId);
				if (preparation.kind === "not-found") {
					new Notice(t("notice.cardMissing"));
					return;
				}
				if (preparation.kind === "blocked") {
					if (preparation.reason === "migration-required") {
						await handleRequestHomeMigration(deckId);
					} else {
						new Notice(t("identity.editNeedsRepair"));
					}
					return;
				}

				setCardEditor({
					mode: "edit",
					deckId,
					cardId: preparation.card.id,
					front: preparation.card.front,
					back: preparation.card.back,
					explanation: preparation.card.explanation ?? "",
				});
			})();
		},
		[cardIdentityContinuity, handleRequestHomeMigration, t],
	);

	const handleSaveCardEditor = useCallback(
		async ({ deckId, front, back, explanation }: CardEditorSavePayload) => {
			if (!cardEditor) return;

			const request: CardMutationRequest =
				cardEditor.mode === "edit"
					? {
							kind: "edit",
							deckId: cardEditor.deckId,
							cardId: cardEditor.cardId,
							content: { front, back, explanation },
						}
					: {
							kind: "create",
							deckId,
							content: { front, back, explanation },
						};

			const outcome = await executeCardMutationWorkflow(cardIdentityContinuity, request, {
				language: settings.language,
				onRequestMigration: handleRequestHomeMigration,
				notify: (msg) => new Notice(msg),
				t,
			});

			if (outcome.kind === "applied") {
				setCardEditor(null);
			} else if (outcome.kind === "failed") {
				throw new Error(outcome.message);
			}
		},
		[cardEditor, cardIdentityContinuity, handleRequestHomeMigration, settings.language, t],
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

	// Cached derived data keyed on the store revision.
	const studyHistory = useMemo(() => {
		void deckHomeSnapshot.revision;
		if (viewState.type !== "stats") return null;
		return deckHome.getStudyHistory();
	}, [deckHome, deckHomeSnapshot.revision, viewState.type]);
	const practiceSetupPlan = useMemo(() => {
		void deckHomeSnapshot.revision;
		if (viewState.type !== "practice-setup") return null;
		const deck = deckHome.getDeck(viewState.deckId);
		if (!deck) return null;
		return getPracticeSetupPlan(deck, viewState.initialSelection);
	}, [deckHome, deckHomeSnapshot.revision, viewState]);
	const spellingSetupPlan = useMemo(() => {
		void deckHomeSnapshot.revision;
		if (viewState.type !== "spelling-setup") return null;
		const deck = deckHome.getDeck(viewState.deckId);
		if (!deck) return null;
		return getSpellingSetupPlan(
			deck,
			deckHome.getSpellingProgress(),
			viewState.initialSelection,
		);
	}, [deckHome, deckHomeSnapshot.revision, viewState]);

	const handleDeleteCard = useCallback(
		async (deckId: string, cardId: string) => {
			await navigation.confirm(
				{
					title: t("cardEditor.deleteCurrentTitle"),
					message: t("cardEditor.deleteConfirm"),
					confirmText: t("settings.delete"),
					tone: "danger",
				},
				async () => {
					await executeCardMutationWorkflow(
						cardIdentityContinuity,
						{ kind: "delete", deckId, cardId },
						{
							language: settings.language,
							onRequestMigration: handleRequestHomeMigration,
							notify: (msg) => new Notice(msg),
							t,
						},
					);
				},
			);
		},
		[cardIdentityContinuity, navigation, handleRequestHomeMigration, settings.language, t],
	);

	const handleDeleteCardRequest = useCallback(
		(deckId: string, cardId: string) => {
			void handleDeleteCard(deckId, cardId);
		},
		[handleDeleteCard],
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

	const renderHome = () => (
		<DeckList
			snapshot={deckHomeSnapshot}
			home={deckHome}
			ownerId={deckHomeOwnerId}
			onNavigate={handleHomeNavigate}
			onRequestMigration={handleRequestHomeMigration}
			onOpenSourceFile={handleOpenSourceFile}
			onOpenStats={handleOpenStats}
			onOpenSettings={onOpenSettings}
			onOpenAddCard={handleOpenAddCard}
			onOpenTranslation={onOpenTranslation}
			onOpenDictionary={onOpenDictionary}
			onOpenVideoPlayer={onOpenVideoPlayer}
		/>
	);

	const renderContent = (): React.ReactNode => {
		if (presentedLifecycleSnapshot.kind === "active") {
			if (presentedLifecycleSnapshot.mode === "study") {
				return (
					<CardView
						session={presentedLifecycleSnapshot}
						transition={answerPresentationTransition}
						isTransitioning={isAnswerTransitioning}
						onComplete={handleSessionComplete}
						onEditCard={handleOpenEditCard}
						onDeleteCard={handleDeleteCardRequest}
						onClose={handleExitActive}
						markdownRenderer={renderMarkdown}
						pronunciationRuntime={pronunciationRuntime}
						pronunciationEnabled={Boolean(
							settings.wordLearningDecks[
								presentedLifecycleSnapshot.currentCard.currentDeckId
							],
						)}
					/>
				);
			}
			if (presentedLifecycleSnapshot.mode === "practice") {
				return (
					<PracticeView
						session={presentedLifecycleSnapshot}
						transition={answerPresentationTransition}
						isTransitioning={isAnswerTransitioning}
						onEditCard={handleOpenEditCard}
						onDeleteCard={handleDeleteCardRequest}
						onClose={handleExitActive}
						markdownRenderer={renderMarkdown}
						pronunciationRuntime={pronunciationRuntime}
						pronunciationEnabled={Boolean(
							settings.wordLearningDecks[
								presentedLifecycleSnapshot.currentCard.currentDeckId
							],
						)}
					/>
				);
			}
			return (
				<SpellingView
					session={presentedLifecycleSnapshot}
					transition={answerPresentationTransition}
					isTransitioning={isAnswerTransitioning}
					feedback={answerPresentationSnapshot.spellingFeedback}
					onEditCard={handleOpenEditCard}
					onDeleteCard={handleDeleteCardRequest}
					onClose={handleExitActive}
					markdownRenderer={renderMarkdown}
					pronunciationRuntime={pronunciationRuntime}
				/>
			);
		}

		if (presentedLifecycleSnapshot.kind === "result") {
			if (presentedLifecycleSnapshot.mode === "study") {
				return (
					<StudySummary
						result={presentedLifecycleSnapshot}
						onHome={handleResultHomeClick}
						onRestart={handlePracticeRestart}
					/>
				);
			}
			return presentedLifecycleSnapshot.mode === "practice" ? (
				<PracticeSummary
					result={presentedLifecycleSnapshot}
					onRestart={handlePracticeRestart}
					onPracticeIncorrect={handlePracticeRetryIncorrect}
					onHome={handleResultHomeClick}
					markdownRenderer={renderMarkdown}
				/>
			) : (
				<SpellingSummary
					result={presentedLifecycleSnapshot}
					onRetryIncorrect={handlePracticeRetryIncorrect}
					onRestart={handlePracticeRestart}
					onHome={handleResultHomeClick}
					markdownRenderer={renderMarkdown}
				/>
			);
		}

		switch (viewState.type) {
			case "study-setup": {
				const deck = deckHome.getDeck(viewState.deckId);
				if (!deck) {
					return renderHome();
				}
				const effectiveSettings = deckHome.getEffectiveStudySettings(viewState.deckId);
				const plan = getStudySetupPlan(
					deck,
					effectiveSettings,
					new Date(),
					viewState.initialStudyOrder,
				);
				return (
					<StudySetup
						key={deck.id}
						deck={deck}
						plan={plan}
						defaultDirection={viewState.initialDirection ?? "normal"}
						spellingEnabled={Boolean(settings.wordLearningDecks[viewState.deckId])}
						onStartSession={handleStartSession}
						onBack={handleBackHome}
					/>
				);
			}

			case "practice-setup": {
				const deck = deckHome.getDeck(viewState.deckId);
				if (!deck) {
					return renderHome();
				}
				const plan =
					practiceSetupPlan ?? getPracticeSetupPlan(deck, viewState.initialSelection);
				return (
					<PracticeSetup
						key={deck.id}
						deck={deck}
						plan={plan}
						defaultDirection={viewState.initialDirection ?? "normal"}
						initialDirection={viewState.initialDirection}
						onStartSession={handleStartSession}
						onBack={handleBackHome}
					/>
				);
			}

			case "spelling-setup": {
				const deck = deckHome.getDeck(viewState.deckId);
				if (!deck) return renderHome();
				const plan =
					spellingSetupPlan ??
					getSpellingSetupPlan(
						deck,
						deckHome.getSpellingProgress(),
						viewState.initialSelection,
					);
				return (
					<SpellingSetup
						key={deck.id}
						deck={deck}
						plan={plan}
						onStartSession={handleStartSession}
						onBack={handleBackHome}
					/>
				);
			}

			case "word-list": {
				const deck = deckHome.getDeck(viewState.deckId);
				if (!deck) {
					return renderHome();
				}
				return (
					<WordListView
						key={deck.id}
						deck={deck}
						onBack={handleBackHome}
						onRecordVisit={(startTimeMs, endTimeMs) => {
							handleRecordWordListVisit(deck.id, startTimeMs, endTimeMs);
						}}
					/>
				);
			}

			case "stats":
				return <StatsView history={studyHistory ?? []} onBack={handleBackHome} />;

			case "home":
			default:
				return renderHome();
		}
	};

	return (
		<ModalProvider host={modalHost}>
			{renderContent()}
			{cardEditor && (
				<CardEditorModal
					mode={cardEditor.mode}
					decks={deckHomeSnapshot.decks}
					initialDeckId={cardEditor.deckId}
					initialFront={cardEditor.mode === "edit" ? cardEditor.front : ""}
					initialBack={cardEditor.mode === "edit" ? cardEditor.back : ""}
					initialExplanation={cardEditor.mode === "edit" ? cardEditor.explanation : ""}
					onSave={handleSaveCardEditor}
					onClose={handleCloseCardEditor}
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
		</ModalProvider>
	);
};
