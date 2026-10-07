export type FavoriteSaveFailure =
	| "migration-required"
	| "source-needs-repair"
	| "source-changing"
	| "invalid-card-content";

export class FavoriteSaveError extends Error {
	constructor(readonly reason: FavoriteSaveFailure) {
		super(reason);
		this.name = "FavoriteSaveError";
	}
}
