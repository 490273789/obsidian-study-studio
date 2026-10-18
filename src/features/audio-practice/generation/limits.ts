/**
 * Single source for the audio limits shared by admission and generation.
 *
 * The workflow rejects oversized files before reading them; the generation
 * engine keeps its own defensive checks because the duration is only known
 * after decoding the audio.
 */
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export const MAX_AUDIO_DURATION_SECONDS = 600;
