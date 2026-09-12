import type { FlashcardStudySettings } from "../../../settings/slice";
import {
	FlashcardAuthorityConflictError,
	type FlashcardAuthority,
	type FlashcardAuthorityChange,
	type FlashcardAuthorityCommit,
	type FlashcardAuthoritySnapshot,
	type LearningStateDocument,
} from "../persistenceTypes";

/** In-memory adapter used by persistence seam tests, including Sync and failure paths. */
export class MemoryFlashcardAuthority implements FlashcardAuthority {
	private version = 0;
	private learning: LearningStateDocument | undefined;
	private readonly listeners = new Set<
		(change: FlashcardAuthorityChange) => void | Promise<void>
	>();
	failNextCommit = false;

	constructor(
		private settings: FlashcardStudySettings,
		learning?: LearningStateDocument,
	) {
		this.learning = learning && structuredClone(learning);
	}

	async read(): Promise<FlashcardAuthoritySnapshot> {
		return {
			version: this.version,
			settings: structuredClone(this.settings),
			content: this.learning
				? { kind: "current", learning: structuredClone(this.learning) }
				: { kind: "current" },
		};
	}

	async commit(
		expectedVersion: number,
		commit: FlashcardAuthorityCommit,
	): Promise<{ readonly version: number }> {
		if (expectedVersion !== this.version) {
			throw new FlashcardAuthorityConflictError(expectedVersion, this.version);
		}
		if (this.failNextCommit) {
			this.failNextCommit = false;
			throw new Error("memory authority unavailable");
		}
		this.learning = structuredClone(commit.learning);
		this.version++;
		return { version: this.version };
	}

	subscribe(listener: (change: FlashcardAuthorityChange) => void | Promise<void>): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	replaceExternal(
		settings: FlashcardStudySettings,
		learning: LearningStateDocument | undefined,
	): void {
		this.settings = structuredClone(settings);
		this.learning = learning && structuredClone(learning);
		this.version++;
		for (const listener of this.listeners)
			void listener({ kind: "external", version: this.version });
	}
}
