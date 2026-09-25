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

## Study scheduling

`src/features/flashcards/domain/sessions/scheduler.ts` and `src/features/flashcards/domain/sessions/studySessionEngine.ts` own study semantics.

- Ratings 1–4 map to FSRS Again, Hard, Good, and Easy.
- Rating 5 is the custom “熟练” path (`ratings.trash`, `scheduler.rateAsGarbage`) and schedules 21 days later.
- Keep button labels, displayed intervals, and keyboard shortcuts aligned.
- Undo restores the affected card's scheduling state before its most recent answer event; it is not queue-only navigation.
- Be cautious with due-date math and serialized `ts-fsrs` fields.

## Practice and spelling

- Session startup uses domain-owned `SessionStartRequest`, `PracticeSelection`, and `SpellingSelection` definitions; restarting a completed practice/spelling session routes via `getRestartViewState(setupDefaults)`.
- Practice selection and queue planning belong in `sessionPlanner.ts`; transitions/results belong in `sessionEngine.ts` and are orchestrated by `SessionLifecycle`.
- Spelling eligibility and answer normalization live in `src/features/flashcards/domain/cards/spellingWord.ts`. A spellable front is a single-line Latin word or phrase, optionally wrapped in one ATX heading or one Markdown emphasis wrapper.
- Spelling queue planning and readiness evaluation live in `sessionPlanner.ts`; retrieval/correction transitions live in `spellingSessionEngine.ts`.
- Spelling progress is keyed by stable card identity. Do not fall back to card position or bypass identity requirements.
- In spelling, only the first retrieval attempt for each selected card counts toward first-try results; correction attempts remain separate events.

## Answer presentation

`src/features/flashcards/ui/answerPresentationTransition.ts` owns one learner-visible answer transaction per mounted React adapter.

- It serializes input, retains the previously presented lifecycle snapshot while an action commits and feedback/delay settles, and then publishes the next snapshot once.
- It owns answer-transition delays, spelling feedback retention, optional pronunciation wait, and unsubscribe cleanup.
- `CardView`, `PracticeView`, and `SpellingView` retain rendering, keyboard mapping, focus, and mode-specific controls. Do not reintroduce per-component timer/pending-action state.

Add focused tests under `src/features/flashcards/domain/sessions/__tests__/`, `src/features/flashcards/domain/cards/__tests__/`, and `src/core/ui/__tests__/` when applicable. Prefer tests through `SessionLifecycle` and `AnswerPresentationTransition`, with pure-engine tests for focused algorithms.
