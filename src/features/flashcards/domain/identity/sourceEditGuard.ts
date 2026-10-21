import type { Deck, FlashCard } from "../../../../core/shared/types";
import { extractCardIdentityMarker, extractFirstTag } from "../cards/cardFormat";
import { parseFlashcards } from "../cards/parser";
import type {
	ContinuitySourceDocument,
	ContinuitySourceStore,
	PersistedCardIdentityContinuityState,
} from "./cardIdentityContinuity";

/** The persisted facts one editability decision needs. */
export interface SourceEditState {
	readonly configuredTags: readonly string[];
	readonly decks: ReadonlyMap<string, Deck>;
	readonly continuity: PersistedCardIdentityContinuityState;
}

export type SourceEditGuardOutcome =
	| {
			readonly kind: "ready";
			readonly document: ContinuitySourceDocument;
			readonly deck: Deck | undefined;
			readonly cards: readonly FlashCard[];
	  }
	| {
			readonly kind: "blocked";
			readonly reason: "source-needs-repair" | "migration-required";
			readonly issueId?: string;
	  }
	| { readonly kind: "unmanaged" }
	| { readonly kind: "source-changing" }
	| { readonly kind: "failed"; readonly message: string };

export function isLegacyIdentity(filePath: string, cardIdentity: string): boolean {
	return cardIdentity.startsWith(`${filePath}::`);
}

/**
 * The single "may this source be edited?" decision. Both edit entries (whole
 * source batch from another feature, and card-identity edits from the flashcard
 * UI) cross this guard so journal, migration, repair, duplicate identity and
 * managed-source rules cannot drift apart.
 *
 * `expectedContent` is supplied by callers that read the file before starting
 * the transaction; without it the guard still reads a fresh source and applies
 * every other rule.
 */
export async function guardSourceForEdit(input: {
	readonly path: string;
	readonly expectedContent?: string;
	readonly state: SourceEditState;
	readonly sourceStore: ContinuitySourceStore;
}): Promise<SourceEditGuardOutcome> {
	try {
		const { state, sourceStore } = input;
		if (state.continuity.journal) {
			return { kind: "blocked", reason: "source-needs-repair" };
		}
		// No tag filter: source edits must see fresh targets and global identities,
		// including sources whose metadata cache has not caught up yet.
		const documents = await sourceStore.list();
		const target = sourceStore.read
			? await sourceStore.read(input.path)
			: documents.find((document) => document.path === input.path);
		if (!target) {
			return input.expectedContent === undefined
				? { kind: "blocked", reason: "source-needs-repair" }
				: { kind: "source-changing" };
		}
		if (input.expectedContent !== undefined && target.content !== input.expectedContent) {
			return { kind: "source-changing" };
		}

		const deck = state.decks.get(input.path);
		const tag = extractFirstTag(target.content);
		const managed =
			Boolean(deck || state.continuity.sources[input.path]) ||
			Boolean(
				tag &&
				state.configuredTags.some(
					(configured) => configured.toLowerCase() === tag.toLowerCase(),
				),
			);
		if (!managed) {
			// Identity markers remain protected even after a source leaves the
			// configured index. Raw block edits could orphan or reattach them.
			const hasStableIdentity = target.content
				.split(/\r?\n/)
				.some((line) => extractCardIdentityMarker(line) !== null);
			return hasStableIdentity
				? { kind: "blocked", reason: "source-needs-repair" }
				: { kind: "unmanaged" };
		}
		if (
			deck &&
			(!tag ||
				!state.configuredTags.some(
					(configured) => configured.toLowerCase() === tag.toLowerCase(),
				))
		) {
			return { kind: "blocked", reason: "source-needs-repair" };
		}
		const condition = state.continuity.sources[input.path];
		if (
			condition?.type === "legacy" ||
			deck?.cards.some((card) => isLegacyIdentity(input.path, card.id))
		) {
			return { kind: "blocked", reason: "migration-required" };
		}
		if (condition?.type === "last-known-good") {
			return {
				kind: "blocked",
				reason: "source-needs-repair",
				issueId: state.continuity.issues.find((issue) =>
					issue.affectedSources.includes(input.path),
				)?.id,
			};
		}
		const cards = parseFlashcards(target.content, input.path);
		if (cards.some((card) => isLegacyIdentity(input.path, card.id))) {
			const currentIdentities = new Set(cards.map((card) => card.id));
			const missingStableIdentity = deck?.cards.some(
				(card) => !currentIdentities.has(card.id),
			);
			return {
				kind: "blocked",
				reason: missingStableIdentity ? "source-needs-repair" : "migration-required",
			};
		}
		const counts = new Map<string, number>();
		for (const document of documents) {
			if (document.path === input.path) continue;
			for (const line of document.content.split(/\r?\n/)) {
				const identity = extractCardIdentityMarker(line);
				if (identity) counts.set(identity, (counts.get(identity) ?? 0) + 1);
			}
		}
		for (const line of target.content.split(/\r?\n/)) {
			const identity = extractCardIdentityMarker(line);
			if (identity) counts.set(identity, (counts.get(identity) ?? 0) + 1);
		}
		if (cards.some((card) => counts.get(card.id) !== 1)) {
			return { kind: "blocked", reason: "source-needs-repair" };
		}
		return { kind: "ready", document: target, deck, cards };
	} catch (error) {
		return {
			kind: "failed",
			message: error instanceof Error ? error.message : "Card source preparation failed",
		};
	}
}
