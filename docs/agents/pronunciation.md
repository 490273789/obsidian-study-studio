# Pronunciation Guide

Read this guide before changing pronunciation settings, playback, spelling autoplay, or local voice selection.

## Runtime authority

`src/features/flashcards/domain/pronunciation/pronunciationRuntime.ts` is a plugin-lifetime service owned by the 闪卡 feature (`src/features/flashcards.ts`), which constructs and disposes it. It is shared with the view boundary by injection.

- Its immutable snapshot is the in-process authority for committed pronunciation settings, management activity, voice capability, and playback state.
- Settings adapters call semantic methods such as `configure()`; they must not mirror or directly mutate pronunciation settings/activity.
- Configuration is persisted before the committed snapshot is published. The write goes through `host.updateSettings({ pronunciation })`, and the composition root serializes settings commits so a stale write cannot overwrite a newer pronunciation configuration.
- UI components consume the runtime interface. They must not create a second runtime.

## Voice capability and playback rules

Pronunciation is local-only using the platform's speech synthesis engine:

1. A matching local English `SpeechSynthesisVoice` (matching preferred accent if specified, or default local English, or any local English voice).
2. If no local English voice is installed on the device, speech is reported as unavailable (`not-configured`).

- Stop playback when the current card/session changes, the view closes, or the consumer unmounts.
- Dispose voice change listeners on plugin unload.
- Spelling autoplay reads the same runtime snapshot as manual playback and lets `AnswerPresentationTransition` own the presentation wait.
- A configuration change cancels active playback.

Add focused tests under `src/features/flashcards/domain/pronunciation/__tests__/` and, for spelling integration, `src/features/flashcards/domain/sessions/__tests__/` or `src/core/ui/__tests__/`.
