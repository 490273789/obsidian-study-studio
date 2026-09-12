import { aiSettingsSlice } from "../ai/configuration";
import { dictionarySettingsSlice } from "../../features/dictionary/domain/configuration";
import { pronunciationSettingsSlice } from "../../features/flashcards/domain/pronunciation/pronunciationSettings";
import type { FlashcardSettings } from "../shared/types";
import { translationSettingsSlice } from "../../features/translation/domain/configuration";
import { flashcardSettingsSlice } from "../../features/flashcards/settings/slice";
import { hostSettingsSlice } from "../settings/hostSlice";
import { selectionPopupSettingsSlice } from "../selectionHelper/settings/slice";
import type { SettingsSlice } from "../settings/slice";
import type { HostSettings } from "../settings/hostSlice";

/**
 * Every slice of the persisted settings document, in normalization order.
 *
 * Order matters: the host slice normalizes `language` first, and the 闪卡 slice
 * derives its language-dependent practice-message defaults from the same raw
 * document rather than from another slice's output.
 *
 * This list is the canonical inventory. `DEFAULT_SETTINGS`,
 * `normalizeSettingsDocument`, and `cloneSettingsDocument` below compose the same
 * slices explicitly so their result type stays checkable; the settings-slice test
 * asserts the lists agree.
 */
export const SHARED_SETTINGS_SLICES = [hostSettingsSlice] as const;

/** The canonical ownership map used for both static projections and runtime authorization. */
export const SETTINGS_SLICES_BY_OWNER = {
	workbench: [aiSettingsSlice],
	flashcards: [flashcardSettingsSlice, pronunciationSettingsSlice],
	translation: [translationSettingsSlice],
	dictionary: [dictionarySettingsSlice],
	selectionHelper: [selectionPopupSettingsSlice],
} as const;

export const SETTINGS_SLICES = [
	...SHARED_SETTINGS_SLICES,
	...SETTINGS_SLICES_BY_OWNER.workbench,
	...SETTINGS_SLICES_BY_OWNER.flashcards,
	...SETTINGS_SLICES_BY_OWNER.translation,
	...SETTINGS_SLICES_BY_OWNER.dictionary,
	...SETTINGS_SLICES_BY_OWNER.selectionHelper,
] as const;

export type SettingsOwner = keyof typeof SETTINGS_SLICES_BY_OWNER;
export type FeatureSettingsOwner = Exclude<SettingsOwner, "workbench">;

type SliceDocument<TSlice> = TSlice extends SettingsSlice<infer TDocument> ? TDocument : never;
type UnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (
	value: infer TIntersection,
) => void
	? TIntersection
	: never;

export type OwnedSettings<TOwner extends SettingsOwner> = UnionToIntersection<
	SliceDocument<(typeof SETTINGS_SLICES_BY_OWNER)[TOwner][number]>
>;
export type SharedWorkbenchSettings = HostSettings;
export type ScopedWorkbenchSettings<TOwner extends SettingsOwner> = Readonly<
	SharedWorkbenchSettings & OwnedSettings<TOwner>
>;

export class SettingsScopeViolation extends Error {
	constructor(
		readonly moduleId: string,
		readonly unauthorizedKeys: readonly string[],
	) {
		super(
			`Workbench module ${moduleId} cannot update settings keys: ${unauthorizedKeys.join(", ")}`,
		);
		this.name = "SettingsScopeViolation";
	}
}

export function settingsOwners(): SettingsOwner[] {
	return Object.keys(SETTINGS_SLICES_BY_OWNER) as SettingsOwner[];
}

export function settingsOwnerKeys(owner: SettingsOwner): readonly string[] {
	return SETTINGS_SLICES_BY_OWNER[owner].flatMap((slice) => [...slice.keys]);
}

export function authorizeSettingsPatch<TOwner extends SettingsOwner>(
	owner: TOwner,
	patch: Readonly<Partial<OwnedSettings<TOwner>>>,
): Partial<OwnedSettings<TOwner>> {
	if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
		throw new SettingsScopeViolation(owner, ["<invalid-patch>"]);
	}
	const allowed = new Set(settingsOwnerKeys(owner));
	const unauthorized = Reflect.ownKeys(patch)
		.filter((key) => typeof key !== "string" || !allowed.has(key))
		.map(String)
		.sort();
	if (unauthorized.length > 0) throw new SettingsScopeViolation(owner, unauthorized);
	return structuredClone(patch);
}

export function projectSettings<TOwner extends SettingsOwner>(
	owner: TOwner,
	document: FlashcardSettings,
): ScopedWorkbenchSettings<TOwner> {
	const projection: Record<string, unknown> = {};
	for (const slice of SHARED_SETTINGS_SLICES) {
		Object.assign(projection, slice.clone(document));
	}
	const ownedSlices = SETTINGS_SLICES_BY_OWNER[
		owner
	] as unknown as readonly SettingsSlice<object>[];
	for (const slice of ownedSlices) Object.assign(projection, slice.clone(document));
	return projection as ScopedWorkbenchSettings<TOwner>;
}

export function changedSettingsOwners(
	previous: FlashcardSettings,
	next: FlashcardSettings,
): Set<SettingsOwner> {
	const changed = new Set<SettingsOwner>();
	for (const owner of settingsOwners()) {
		if (
			settingsOwnerKeys(owner).some(
				(key) =>
					!settingsValuesEqual(
						previous[key as keyof FlashcardSettings],
						next[key as keyof FlashcardSettings],
					),
			)
		) {
			changed.add(owner);
		}
	}
	return changed;
}

export function validateSettingsOwnership(): void {
	const sliceIds = new Set<string>();
	const keys = new Set<string>();
	for (const slice of SETTINGS_SLICES) {
		if (sliceIds.has(slice.id)) throw new Error(`Duplicate settings slice id: ${slice.id}`);
		sliceIds.add(slice.id);
		for (const key of slice.keys) {
			if (keys.has(key)) throw new Error(`Overlapping settings key: ${key}`);
			keys.add(key);
		}
	}
	const sharedKeys = SHARED_SETTINGS_SLICES.flatMap((slice) => [...slice.keys]);
	if (sharedKeys.length !== 1 || sharedKeys[0] !== "language") {
		throw new Error("The shared settings context must contain only language");
	}
}

function settingsValuesEqual(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Defaults composed from every slice. Each slice is the authority for its own
 * keys, so this aggregate no longer holds a second copy of them.
 */
export const DEFAULT_SETTINGS: FlashcardSettings = {
	...hostSettingsSlice.defaults(),
	...flashcardSettingsSlice.defaults(),
	...pronunciationSettingsSlice.defaults(),
	...aiSettingsSlice.defaults(),
	...translationSettingsSlice.defaults(),
	...dictionarySettingsSlice.defaults(),
	...selectionPopupSettingsSlice.defaults(),
};

/**
 * Merges a raw persisted document with defaults while preserving old-data
 * compatibility. Each slice sees the whole raw document and returns only its own
 * keys, so legacy top-level shapes stay inside the slice that understands them.
 */
export function normalizeSettingsDocument(raw: unknown): FlashcardSettings {
	return {
		...hostSettingsSlice.normalize(raw),
		...flashcardSettingsSlice.normalize(raw),
		...pronunciationSettingsSlice.normalize(raw),
		...aiSettingsSlice.normalize(raw),
		...translationSettingsSlice.normalize(raw),
		...dictionarySettingsSlice.normalize(raw),
		...selectionPopupSettingsSlice.normalize(raw),
	};
}

/**
 * Returns a settings document the caller cannot mutate back into committed state.
 * Each slice decides how deep its own copy must be.
 */
export function cloneSettingsDocument(settings: FlashcardSettings): FlashcardSettings {
	return {
		...hostSettingsSlice.clone(settings),
		...flashcardSettingsSlice.clone(settings),
		...pronunciationSettingsSlice.clone(settings),
		...aiSettingsSlice.clone(settings),
		...translationSettingsSlice.clone(settings),
		...dictionarySettingsSlice.clone(settings),
		...selectionPopupSettingsSlice.clone(settings),
	};
}
