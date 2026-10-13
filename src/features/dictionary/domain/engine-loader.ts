import initEngine from "./engine/dictionary_engine.js";

let initialized: Promise<unknown> | null = null;

/**
 * Initializes the dictionary engine once per bundle.
 *
 * The wasm-bindgen glue already resolves its own `dictionary_engine_bg.wasm`
 * through `new URL(..., import.meta.url)`; the bundler inlines that reference as
 * the single data URI. Passing an explicit `?url` import here would inline a
 * second, byte-identical copy of the 654 KiB engine into `main.js`.
 */
export function ensureDictionaryEngine(): Promise<unknown> {
	return (initialized ??= initEngine());
}
