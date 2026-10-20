# Session Guide

Read this guide before changing study, practice, spelling, FSRS scheduling, session results, retry, undo, source reconciliation, or answer presentation.

## Unified lifecycle

`src/features/flashcards/domain/sessions/sessionLifecycle.ts` is the shared plugin-lifetime authority for all session modes.

- Exactly one snapshot branch exists: `idle`, `active`, or `result`.
- Only `active` counts as an active session. A retained practice/spelling result does not block source synchronization.
- Setup drafts remain in React; view-local routes and confirmations belong to `FlashcardNavigation`. The lifecycle begins only after validated `start()` succeeds.
- React uses immutable snapshots and revision-bound typed references. Stale callbacks must be rejected rather than applied to a newer state.
- Lifecycle transitions make their write set durable before publishing observable state. Failure keeps the prior lifecycle and persisted data unchanged.
- Closing the Obsidian view does not end an active session. Normal completion, explicit exit, or source-change termination does.
- An explicit study exit records partial history only after at least one answer event; it does not count as normal completion.
- Practice/spelling results are immutable content snapshots. Incorrect retry revalidates identities against the current deck index.

Pure engines and planners under `src/features/flashcards/domain/sessions/` are internal seams. Keep React, Obsidian calls, notices, timers, and persistence I/O out of them.

## Source changes during a session

- The session card set is fixed by stable identity at start.
- Edited or moved identities remain; deleted identities leave current/future queues; newly added cards do not enter.
- Completed answer events survive deletion for history/statistics.
- If every remaining eligible identity disappears, end with the source-change outcome rather than normal completion.
- `CardIdentityContinuity` talks to sessions only through the narrow continuity adapter created with `SessionLifecycle`.
- Persistence announces committed deck-structure and challenge-progress revisions through
  `SessionPersistencePort.subscribeSourceChanges`; the lifecycle subscribes itself and
  reconciles the active challenge, so the composition root never pumps revalidation.
  Challenge reconciliation keys off the revisions cached in its active state, which also
  absorbs the revision echo of its own answer commits.
- Interactive intents (`start`/`act`) wait out background reconciliation instead of being
  rejected for it; only two concurrent interactive intents produce `busy`.

## Study scheduling

`src/features/flashcards/domain/sessions/scheduler.ts` and `src/features/flashcards/domain/sessions/studySessionEngine.ts` own study semantics.

- Ratings 1–4 map to FSRS Again, Hard, Good, and Easy.
- Rating 5 is the custom “熟练” path (`ratings.trash`, `scheduler.rateAsGarbage`) and schedules 21 days later.
- Keep button labels, displayed intervals, and keyboard shortcuts aligned.
- Undo restores the affected card's scheduling state before its most recent answer event; it is not queue-only navigation.
- Be cautious with due-date math and serialized `ts-fsrs` fields.

## Practice and spelling

- Session startup uses domain-owned `SessionStartRequest`, `PracticeSelection`, and `SpellingSelection` definitions. Result snapshots expose mode-neutral `SessionRestartOrigin`; `FlashcardNavigation` maps it to a view route with `toRestartViewState`, so the domain never names `ViewState`.
- `sessionPlanner.ts` exposes semantic planning entries only: the three setup plans, `evaluateSpellingDeckEligibility`, `planSessionQueue`, and `planRetryIncorrectSession`. Sorting, day slicing, and per-mode plan helpers stay private; do not re-export them or add forwarding facades. Tests drive planning through the semantic entries. `practiceSessionEngine.ts` exposes session creation, answer, and undo only; `SessionLifecycle` orchestrates transitions and results.
- Spelling eligibility and answer normalization live in `src/features/flashcards/domain/cards/spellingWord.ts`. A spellable front is a single-line Latin word or phrase, optionally wrapped in one ATX heading or one Markdown emphasis wrapper.
- Spelling queue planning and readiness evaluation live in `sessionPlanner.ts`; retrieval/correction transitions live in `spellingSessionEngine.ts`.
- Spelling progress is keyed by stable card identity. Do not fall back to card position or bypass identity requirements.
- In spelling, only the first retrieval attempt for each selected card counts toward first-try results; correction attempts remain separate events.

## Answer presentation

`src/features/flashcards/ui/answerPresentationTransition.ts` owns one learner-visible answer transaction per mounted React adapter.

- It serializes input, retains the previously presented lifecycle snapshot while an action commits and feedback/delay settles, and then publishes the next snapshot once.
- It owns answer-transition delays, spelling feedback retention, optional pronunciation wait, and unsubscribe cleanup.
- Its `cardPresentation` snapshot owns study/practice answer visibility and automatic pronunciation. Reveal/toggle actions carry the presented revision-bound reference; word-learning deck eligibility is updated through `setWordLearningDecks()`.
- A new encounter (including returning/undoing, consecutive answers on the same identity, or front/back edits) hides the answer and creates one automatic pronunciation opportunity when the word becomes visible. Explanation/source-only changes preserve visibility and do not replay. Autoplay persists across cards, resets on session/mode changes or last unsubscribe, and presentation changes follow the committed snapshot after its delay.
- Views retain mode-specific controls, inputs, shortcuts, and transactions. Study/practice/spelling/challenge dispatch semantic actions directly through `transition.act(action)`; the transition stays the deep authority for busy rejection, card motion, auto-pronunciation, and terminal-failure reporting, while the show-answer footer is shared through `sessionSurfaceFooter`. `src/features/flashcards/ui/presentation/` owns the shared 卡片呈现 derivation and question/answer/explanation rendering; challenge answer visibility and feedback stay with its view, and spelling input submission stays local. Do not reintroduce per-component timer/pending-action state.

## Session persistence

`src/features/flashcards/domain/sessions/sessionPersistence.ts` is the whole persistence seam the lifecycle sees: minimal reads, the card scheduler, and one atomic `commitSession`. A commit carries session facts only — scheduled card states, spelling attempts, finished/partial session records, and challenge progress with its expected revision. It never carries document-shaped fields such as history entries, learning-activity records, study-count increments, or serialized card maps.

Repository semantic rejections map to lifecycle rejections (`card-missing` → `current-card-unavailable`, `challenge-progress-changed` → `challenge-progress-changed`); only infrastructure failures become `failed`. Every published rejection has a real production path and a typed interface-level test.

`src/features/flashcards/domain/storage/sessionCommitFormat.ts` owns the document conversion: history formatting, activity records, deck study counts, spelling progress, and challenge persistence. `FlashcardRepository.commitSession` validates every scheduled card and the challenge revision first, then applies the formatted write set atomically and returns a semantic result (`applied` with receipt, `rejected` with reason, or `failed` with retryability). A missing card or moved challenge revision is rejected explicitly; it is never skipped silently.

## Card presentation shortcuts

`src/features/flashcards/ui/cardPresentationShortcuts.ts` owns the study, practice,
and challenge card shortcut interpretation, event filtering, and focus lifetime.
`useCardPresentationShortcuts` binds a view's card surface and supplies its latest
presented state and semantic actions. Answer transactions stay with
`AnswerPresentationTransition`; challenge answer visibility stays with its view.

- Shortcuts belong to the focused card surface in its owning document. Initial
  mounting may focus an unclaimed surface; clicking ordinary card content focuses
  it. Rendering a new card does not take focus from another control or view.
- Inputs, editable content, buttons, links, and other interactive controls retain
  their own keyboard behavior. Open dialogs pause card shortcuts. Spelling
  question input and setup-page shortcuts stay outside this module.
- Composing, modified, already-consumed, and unmapped key events pass through.
  Recognized keys prevent the browser default; repeated, busy, or unavailable
  previous-card actions are consumed without dispatching. Propagation continues.
- Preserve existing mode and phase mappings, including study Space = rating 2 and
  challenge feedback Space/Enter = continue. Read the presented state on each
  event; do not capture a prior card's callback or invent parallel transition state.
- Test through the binding interface: observable intents, default prevention,
  focus ownership, dialogs, multiple documents, and idempotent release/rebinding.

Add focused tests under `src/features/flashcards/domain/sessions/__tests__/`, `src/features/flashcards/domain/cards/__tests__/`, and `src/core/ui/__tests__/` when applicable. Prefer tests through `SessionLifecycle` and `AnswerPresentationTransition`, with pure-engine tests for focused algorithms.
