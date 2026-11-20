/* tslint:disable */
/* eslint-disable */

export class CompiledDictionary {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    file_count(): number;
    file_path(index: number): string | undefined;
    take_file(index: number): Uint8Array | undefined;
    readonly engine_version: string;
    readonly entry_count: bigint;
}

export class MdictCompileSession {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    add_mdd(file_id: number, length: number): void;
    file_count(): number;
    file_path(index: number): string | undefined;
    finish(): CompiledDictionary;
    take_file(index: number): Uint8Array | undefined;
    readonly engine_version: string;
    readonly entry_count: bigint;
}

export function begin_mdict_compile(mdx_file_id: number, mdx_length: number, stylesheet: string | null | undefined, script: string | null | undefined, sources_json: string): MdictCompileSession;

export function compile_eudic_file(file_id: number, file_length: number, sources_json: string): CompiledDictionary;

export function compile_mdict_files(mdx_file_id: number, mdx_length: number, mdd_file_ids: Uint32Array, mdd_lengths: Float64Array, stylesheet: string | null | undefined, script: string | null | undefined, sources_json: string): CompiledDictionary;

export function fst_exact(fst_bytes: Uint8Array, key: string): number | undefined;

export function fst_fuzzy(fst_bytes: Uint8Array, query: string, distance: number, limit: number): string;

export function fst_prefix(fst_bytes: Uint8Array, prefix: string, limit: number): string;

export function inflate_zlib(data: Uint8Array, expected_size: number): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_compileddictionary_free: (a: number, b: number) => void;
    readonly __wbg_mdictcompilesession_free: (a: number, b: number) => void;
    readonly begin_mdict_compile: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly compile_eudic_file: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly compile_mdict_files: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => void;
    readonly compileddictionary_engine_version: (a: number, b: number) => void;
    readonly compileddictionary_entry_count: (a: number) => bigint;
    readonly compileddictionary_file_count: (a: number) => number;
    readonly compileddictionary_file_path: (a: number, b: number, c: number) => void;
    readonly compileddictionary_take_file: (a: number, b: number, c: number) => void;
    readonly fst_exact: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly fst_fuzzy: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly fst_prefix: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly inflate_zlib: (a: number, b: number, c: number, d: number) => void;
    readonly mdictcompilesession_add_mdd: (a: number, b: number, c: number, d: number) => void;
    readonly mdictcompilesession_engine_version: (a: number, b: number) => void;
    readonly mdictcompilesession_entry_count: (a: number) => bigint;
    readonly mdictcompilesession_file_count: (a: number) => number;
    readonly mdictcompilesession_file_path: (a: number, b: number, c: number) => void;
    readonly mdictcompilesession_finish: (a: number, b: number) => void;
    readonly mdictcompilesession_take_file: (a: number, b: number, c: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
