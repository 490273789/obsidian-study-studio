import type { ContinuitySourceStore, SynchronizeOutcome } from "./cardIdentityContinuity";

type SourceEditTransactionResult =
	| { readonly kind: "applied" }
	| { readonly kind: "source-changing" }
	| { readonly kind: "failed"; readonly retryable: boolean; readonly message: string };

/**
 * The single write transaction for both edit entries: fresh-content guarded
 * write, then synchronization with the edited source authoritative. Passing the
 * edited path matters because the configured-tag list can miss a source whose
 * metadata is stale; the sync still scans every configured source.
 */
export async function applySourceEditTransaction(input: {
	readonly path: string;
	readonly expectedContent: string;
	readonly nextContent: string;
	readonly sourceStore: ContinuitySourceStore;
	readonly synchronize: (authoritativePath?: string) => Promise<SynchronizeOutcome>;
}): Promise<SourceEditTransactionResult> {
	try {
		if (input.nextContent !== input.expectedContent) {
			const result = await input.sourceStore.replaceIfUnchanged(
				input.path,
				input.expectedContent,
				input.nextContent,
			);
			if (result === "stale") return { kind: "source-changing" };
		}
		const sync = await input.synchronize(input.path);
		if (sync.kind === "failed") {
			return { kind: "failed", retryable: sync.retryable, message: sync.message };
		}
		return { kind: "applied" };
	} catch (error) {
		return {
			kind: "failed",
			retryable: false,
			message: error instanceof Error ? error.message : "Card source change failed",
		};
	}
}
