import type { AudioPracticeRuntime } from "../domain/audioPracticeRuntime";
import type {
	AudioMaterial,
	AudioPracticeCatalog,
	AudioPracticeFileCatalog,
	AudioPracticeFiles,
} from "../domain/types";
import { toAudioFailure, type AudioFailure } from "../domain/failures";

export interface MaterialEditFields {
	readonly title: string;
	readonly audioPath: string;
	readonly subtitlePath: string | null;
	readonly text: string;
}

export interface MaterialEditSessionSnapshot {
	readonly open: boolean;
	readonly mode: "add" | "edit" | null;
	/** Material captured when the edit dialog opened; committing compares against it. */
	readonly expectedMaterial: AudioMaterial | null;
	readonly fields: MaterialEditFields;
	readonly candidates: AudioPracticeFileCatalog;
	readonly readingText: boolean;
	readonly readFailure: AudioFailure | null;
	readonly failure: AudioFailure | null;
	readonly busy: boolean;
	readonly canSubmit: boolean;
}

export interface MaterialEditSessionOptions {
	readonly runtime: Pick<AudioPracticeRuntime, "addMaterial" | "editMaterial">;
	readonly files: Pick<AudioPracticeFiles, "readText">;
	readonly catalog: AudioPracticeCatalog;
}

type MaterialField = keyof MaterialEditFields;

const EMPTY_FIELDS: MaterialEditFields = Object.freeze({
	title: "",
	audioPath: "",
	subtitlePath: null,
	text: "",
});

function emptyCandidates(): AudioPracticeFileCatalog {
	return { audioPaths: [], subtitlePaths: [], textPaths: [] };
}

/**
 * One view's listening-material editor.
 *
 * Owns the dialog presence, all form fields, file reads and their cancellation,
 * the open-time material snapshot, the commit handshake and its typed failure.
 * It never owns playback, subtitle generation, or persisted materials: those
 * stay with `AudioPracticeRuntime`. Two mounted views get two independent
 * sessions, matching the previous per-view dialog behavior.
 */
export class MaterialEditSession {
	private snapshot: MaterialEditSessionSnapshot = Object.freeze({
		open: false,
		mode: null,
		expectedMaterial: null,
		fields: EMPTY_FIELDS,
		candidates: emptyCandidates(),
		readingText: false,
		readFailure: null,
		failure: null,
		busy: false,
		canSubmit: false,
	});
	private readonly listeners = new Set<() => void>();
	private readonly unsubscribeCatalog: () => void;
	private readToken = 0;
	private attempt = 0;
	private disposed = false;

	constructor(private readonly options: MaterialEditSessionOptions) {
		this.unsubscribeCatalog = options.catalog.subscribe(this.refreshCandidates);
		this.refreshCandidates();
	}

	getSnapshot = (): MaterialEditSessionSnapshot => this.snapshot;

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.unsubscribeCatalog();
		this.readToken++;
		this.attempt++;
		this.listeners.clear();
	}

	openAdd(): void {
		if (this.disposed || this.snapshot.busy) return;
		this.readToken++;
		const fields: MaterialEditFields = {
			title: "",
			audioPath: this.snapshot.candidates.audioPaths[0] ?? "",
			subtitlePath: null,
			text: "",
		};
		this.publish({
			open: true,
			mode: "add",
			expectedMaterial: null,
			fields,
			candidates: candidatesFor(fields, this.options.catalog.list()),
			readFailure: null,
			failure: null,
			readingText: false,
		});
	}

	openEdit(material: AudioMaterial): void {
		if (this.disposed || this.snapshot.busy) return;
		this.readToken++;
		const fields: MaterialEditFields = {
			title: material.title,
			audioPath: material.audioPath,
			subtitlePath: material.subtitlePath,
			text: material.originalText,
		};
		this.publish({
			open: true,
			mode: "edit",
			expectedMaterial: material,
			fields,
			candidates: candidatesFor(fields, this.options.catalog.list()),
			readFailure: null,
			failure: null,
			readingText: false,
		});
	}

	setField(field: Exclude<MaterialField, "text">, value: string | null): void {
		if (this.disposed || !this.snapshot.open || this.snapshot.busy) return;
		const fields: MaterialEditFields = {
			...this.snapshot.fields,
			[field]: field === "subtitlePath" ? value || null : (value ?? ""),
		};
		this.publish({
			fields,
			candidates: candidatesFor(fields, this.options.catalog.list()),
		});
	}

	setText(text: string): void {
		if (this.disposed || !this.snapshot.open || this.snapshot.busy) return;
		// Typing manually wins over a pending text-file read.
		this.readToken++;
		this.publish({
			fields: { ...this.snapshot.fields, text },
			readingText: false,
		});
	}

	async readTextFile(path: string): Promise<void> {
		if (this.disposed || !this.snapshot.open || this.snapshot.busy) return;
		const token = ++this.readToken;
		if (!path) {
			this.publish({ readingText: false });
			return;
		}
		this.publish({ readingText: true, readFailure: null });
		try {
			const text = await this.options.files.readText(path);
			if (this.disposed || token !== this.readToken) return;
			this.publish({
				fields: { ...this.snapshot.fields, text },
				readingText: false,
			});
		} catch (error) {
			if (this.disposed || token !== this.readToken) return;
			this.publish({ readingText: false, readFailure: toAudioFailure(error) });
		}
	}

	async submit(): Promise<void> {
		const current = this.snapshot;
		if (this.disposed || !current.open || !current.canSubmit) return;
		const attempt = ++this.attempt;
		const mode = current.mode;
		const expected = current.expectedMaterial;
		const input = this.inputFor(current.fields);
		this.publish({ busy: true, failure: null });
		try {
			if (mode === "edit") {
				if (!expected) throw new Error("Missing expected material");
				await this.options.runtime.editMaterial(expected.id, input, expected);
			} else {
				await this.options.runtime.addMaterial(input);
			}
			if (this.disposed || attempt !== this.attempt) return;
			this.close();
		} catch (error) {
			if (this.disposed || attempt !== this.attempt) return;
			this.publish({ busy: false, failure: toAudioFailure(error) });
		}
	}

	cancel(): void {
		if (this.disposed || this.snapshot.busy) return;
		this.close();
	}

	dismissFailure(): void {
		if (this.disposed || !this.snapshot.failure) return;
		this.publish({ failure: null });
	}

	private close(): void {
		this.readToken++;
		this.attempt++;
		this.publish({
			open: false,
			mode: null,
			expectedMaterial: null,
			fields: EMPTY_FIELDS,
			readFailure: null,
			failure: null,
			readingText: false,
			busy: false,
		});
	}

	private inputFor(fields: MaterialEditFields): {
		title: string;
		audioPath: string;
		subtitlePath: string | null;
		originalText: string;
	} {
		return {
			title: fields.title.trim() || fields.audioPath.split("/").pop() || "",
			audioPath: fields.audioPath,
			subtitlePath: fields.subtitlePath,
			originalText: fields.text,
		};
	}

	private readonly refreshCandidates = (): void => {
		if (this.disposed) return;
		this.publish({
			candidates: candidatesFor(this.snapshot.fields, this.options.catalog.list()),
		});
	};

	private publish(patch: Partial<MaterialEditSessionSnapshot>): void {
		const next = this.snapshotFrom({ ...this.snapshot, ...patch });
		this.snapshot = next;
		for (const listener of this.listeners) {
			try {
				listener();
			} catch (error) {
				console.error("Failed to publish a material edit session:", error);
			}
		}
	}

	private snapshotFrom(
		value: Omit<MaterialEditSessionSnapshot, "canSubmit">,
	): MaterialEditSessionSnapshot {
		const canSubmit =
			value.open &&
			!value.busy &&
			!value.readingText &&
			value.fields.audioPath.trim().length > 0;
		return Object.freeze({
			...value,
			fields: Object.freeze({ ...value.fields }),
			candidates: Object.freeze({
				audioPaths: Object.freeze([...value.candidates.audioPaths]),
				subtitlePaths: Object.freeze([...value.candidates.subtitlePaths]),
				textPaths: Object.freeze([...value.candidates.textPaths]),
			}),
			canSubmit,
		});
	}
}

function candidatesFor(
	fields: MaterialEditFields,
	catalog: AudioPracticeFileCatalog,
): AudioPracticeFileCatalog {
	return {
		audioPaths: mergeCandidate(fields.audioPath, catalog.audioPaths),
		subtitlePaths: mergeCandidate(fields.subtitlePath, catalog.subtitlePaths),
		textPaths: [...catalog.textPaths],
	};
}

function mergeCandidate(value: string | null, candidates: readonly string[]): readonly string[] {
	if (!value) return [...candidates];
	return Array.from(new Set([value, ...candidates]));
}
