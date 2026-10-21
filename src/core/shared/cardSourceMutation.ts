/** Narrow capability for features that edit Markdown containing managed cards. */
export interface CardSourceContent {
	front: string;
	back: string;
	explanation?: string;
}

export interface SourceCard extends CardSourceContent {
	identity: string;
}

export type CardSourceOperation =
	| { kind: "add"; content: CardSourceContent }
	| { kind: "edit"; identity: string; content: CardSourceContent }
	| { kind: "delete"; identity: string };

type CardSourceBlocked = {
	kind: "blocked";
	reason: "migration-required" | "source-needs-repair";
	issueId?: string;
};

type CardSourceFailure = { kind: "failed"; retryable: boolean; message: string };

export type CardSourcePreparation =
	| { kind: "unmanaged" }
	| { kind: "ready"; cards: readonly SourceCard[] }
	| CardSourceBlocked
	| { kind: "source-changing" }
	| CardSourceFailure;

export type CardSourceChangeOutcome =
	| { kind: "applied" }
	| CardSourceBlocked
	| { kind: "source-changing" }
	| CardSourceFailure
	| {
			kind: "validation-failed";
			error:
				| {
						type:
							| "missing-front"
							| "missing-back"
							| "card-not-found"
							| "source-file-invalid";
				  }
				| { type: "reserved-marker"; marker: "??" | "::" | ";;" };
	  };

export interface CardSourceMutation {
	prepare(path: string, expectedContent: string): Promise<CardSourcePreparation>;
	change(request: {
		path: string;
		expectedContent: string;
		changes: readonly CardSourceOperation[];
	}): Promise<CardSourceChangeOutcome>;
}
