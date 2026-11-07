import initEngine from "./engine/dictionary_engine.js";

let initialized: Promise<unknown> | null = null;

/**
 * Initializes the dictionary engine once per bundle.
 *
 * The bundler inlines `dictionary_engine_bg.wasm` via gzip stream compression,
 * transparently decompressed using native `DecompressionStream('gzip')`.
 * Passing an explicit `?url` import here would inline an uncompressed, byte-identical
 * copy into `main.js`.
 */
export function ensureDictionaryEngine(): Promise<unknown> {
	return (initialized ??= initEngine());
}
