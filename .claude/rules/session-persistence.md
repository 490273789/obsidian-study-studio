---
paths:
    - "src/features/flashcards/domain/sessions/sessionPersistence.ts"
---

## Session persistence

`src/features/flashcards/domain/sessions/sessionPersistence.ts` is the whole persistence seam the lifecycle sees: minimal reads, the card scheduler, and one atomic `commitSession`. A commit carries session facts only — scheduled card states, spelling attempts, finished/partial session records, and challenge progress with its expected revision. It never carries document-shaped fields such as history entries, learning-activity records, study-count increments, or serialized card maps.

Repository semantic rejections map to lifecycle rejections (`card-missing` → `current-card-unavailable`, `challenge-progress-changed` → `challenge-progress-changed`); only infrastructure failures become `failed`. Every published rejection has a real production path and a typed interface-level test.

`src/features/flashcards/domain/storage/sessionCommitFormat.ts` turns a commit into the storage write set: card schedules, spelling attempts, and challenge persistence. Session history records, daily learning activity, and deck study counts come from `src/features/flashcards/domain/history/learningRecords.ts`, the shared learning-record seam that formats both session records and word-list visits. It owns the one set of rules: completed study sessions increment study count, only completed/partial facts produce the matching activity, word-list visits under five seconds are dropped, and pending history entries carry `occurredAt` so `appendStudyHistory` stamps the local calendar day and applies the 20-day prune. `FlashcardRepository.commitSession` validates every scheduled card and the challenge revision first, then applies the formatted write set atomically and returns a semantic result (`applied` with receipt, `rejected` with reason, or `failed` with retryability). A missing card or moved challenge revision is rejected explicitly; it is never skipped silently. `recordWordListVisit` formats through the same module and commits the learning-only write set through the same document path, so it cannot grow a second history/activity rule.
