import type { Language } from "../../../core/shared/types";
import type {
	CardIdentityContinuity,
	PluginCardChange,
} from "../domain/identity/cardIdentityContinuity";
import { describeCardChangeOutcome } from "../domain/identity/synchronizationFeedback";
import { createTranslator } from "../strings";
import type { FlashcardNavigation } from "./flashcardNavigation";

export interface CardEditorDraft {
	readonly deckId: string;
	readonly front: string;
	readonly back: string;
	readonly explanation?: string;
}

interface CardEditorSnapshotBase {
	readonly id: number;
	readonly deckId: string;
	readonly front: string;
	readonly back: string;
	readonly explanation: string;
	readonly saving: boolean;
	readonly error: string | null;
}

export type CardEditorSnapshot = CardEditorSnapshotBase &
	({ readonly mode: "create" } | { readonly mode: "edit"; readonly cardId: string });

export interface CardEditingSnapshot {
	readonly editor: CardEditorSnapshot | null;
	readonly preparing: boolean;
}

interface Interaction {
	readonly id: number;
	readonly controller: AbortController;
}

interface CardEditingOptions {
	readonly continuity: Pick<CardIdentityContinuity, "prepareEdit" | "change">;
	readonly navigation: Pick<
		FlashcardNavigation,
		"confirm" | "requestMigration" | "subscribe" | "getSnapshot"
	>;
	readonly notify: (message: string) => void;
	readonly language?: Language;
}

/** One view's editing interaction. Draft text stays in React; durable changes stay in continuity. */
export class CardEditingInteraction {
	private language: Language;
	private t: ReturnType<typeof createTranslator>;
	private lease: object | null = null;
	private current: Interaction | null = null;
	private nextId = 0;
	private readonly listeners = new Set<() => void>();
	private snapshot: CardEditingSnapshot = Object.freeze({ editor: null, preparing: false });

	constructor(private readonly options: CardEditingOptions) {
		this.language = options.language ?? "zh";
		this.t = createTranslator(this.language);
	}

	getSnapshot = (): CardEditingSnapshot => this.snapshot;
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	setLanguage(language: Language): void {
		this.language = language;
		this.t = createTranslator(language);
	}

	mount(): () => void {
		const lease = {};
		this.lease = lease;
		this.invalidate();
		let view = this.options.navigation.getSnapshot().view;
		const unsubscribe = this.options.navigation.subscribe(() => {
			if (this.lease !== lease) return;
			const next = this.options.navigation.getSnapshot().view;
			if (next === view) return;
			view = next;
			this.invalidate();
		});
		return () => {
			unsubscribe();
			if (this.lease !== lease) return;
			this.lease = null;
			this.invalidate();
		};
	}

	openCreate = (deckId: string | null): void => {
		const interaction = this.begin();
		if (!interaction) return;
		if (!deckId) {
			this.options.notify(this.t("notice.noDecks"));
			return;
		}
		this.publish({
			preparing: false,
			editor: {
				id: interaction.id,
				mode: "create",
				deckId,
				front: "",
				back: "",
				explanation: "",
				saving: false,
				error: null,
			},
		});
	};

	openEdit = async (deckId: string, cardId: string): Promise<void> => {
		const interaction = this.begin();
		if (!interaction) return;
		this.publish({ editor: null, preparing: true });
		try {
			const prepared = await this.options.continuity.prepareEdit(deckId, cardId);
			if (!this.isCurrent(interaction)) return;
			if (prepared.kind === "not-found") {
				this.options.notify(this.t("notice.cardMissing"));
			} else if (prepared.kind === "blocked") {
				if (prepared.reason === "migration-required") {
					await this.options.navigation.requestMigration(
						deckId,
						interaction.controller.signal,
					);
				} else this.options.notify(this.t("identity.editNeedsRepair"));
			} else {
				this.publish({
					preparing: false,
					editor: {
						id: interaction.id,
						mode: "edit",
						deckId,
						cardId: prepared.card.id,
						front: prepared.card.front,
						back: prepared.card.back,
						explanation: prepared.card.explanation ?? "",
						saving: false,
						error: null,
					},
				});
			}
		} catch (error) {
			if (this.isCurrent(interaction)) {
				this.options.notify(
					this.t("cardEditor.prepareFailed", { message: this.errorMessage(error) }),
				);
			}
		} finally {
			if (this.isCurrent(interaction)) this.publish({ ...this.snapshot, preparing: false });
		}
	};

	close = (editorId: number): void => {
		if (this.snapshot.editor?.id !== editorId || this.snapshot.editor.saving) return;
		this.invalidate();
	};

	save = async (editorId: number, draft: CardEditorDraft): Promise<void> => {
		const interaction = this.current;
		const editor = this.snapshot.editor;
		if (
			!interaction ||
			!this.isCurrent(interaction) ||
			!editor ||
			editor.id !== editorId ||
			editor.saving
		)
			return;
		const deckId = editor.mode === "edit" ? editor.deckId : draft.deckId.trim();
		if (!deckId) {
			this.publish({
				...this.snapshot,
				editor: { ...editor, error: this.t("cardEditor.deckRequired") },
			});
			return;
		}
		const content = {
			front: draft.front.trim(),
			back: draft.back.trim(),
			explanation: draft.explanation?.trim() || undefined,
		};
		const change: PluginCardChange =
			editor.mode === "edit"
				? { kind: "edit", deckId, cardIdentity: editor.cardId, content }
				: { kind: "add", deckId, content };
		this.publish({ ...this.snapshot, editor: { ...editor, saving: true, error: null } });
		try {
			const applied = await this.change(interaction, change);
			if (applied && this.isCurrent(interaction)) this.invalidate();
		} finally {
			if (this.isCurrent(interaction) && this.snapshot.editor) {
				this.publish({
					...this.snapshot,
					editor: { ...this.snapshot.editor, saving: false },
				});
			}
		}
	};

	delete = async (deckId: string, cardId: string): Promise<void> => {
		const interaction = this.begin();
		if (!interaction) return;
		try {
			await this.options.navigation.confirm(
				{
					title: this.t("cardEditor.deleteCurrentTitle"),
					message: this.t("cardEditor.deleteConfirm"),
					confirmText: this.t("settings.delete"),
					tone: "danger",
				},
				async () => {
					if (this.isCurrent(interaction)) {
						await this.change(interaction, {
							kind: "delete",
							deckId,
							cardIdentity: cardId,
						});
					}
				},
				interaction.controller.signal,
			);
		} catch (error) {
			this.fail(interaction, "delete", this.errorMessage(error));
		}
	};

	private async change(interaction: Interaction, change: PluginCardChange): Promise<boolean> {
		try {
			// Invalidation suppresses presentation only; an accepted write must finish in continuity.
			const outcome = await this.options.continuity.change(change);
			if (!this.isCurrent(interaction)) return false;
			if (outcome.kind === "blocked" && outcome.reason === "migration-required") {
				await this.options.navigation.requestMigration(
					change.deckId,
					interaction.controller.signal,
				);
				return false;
			}
			if (outcome.kind !== "applied") {
				this.fail(
					interaction,
					change.kind,
					describeCardChangeOutcome(outcome, this.language),
				);
				return false;
			}
			this.options.notify(
				this.t(
					change.kind === "add"
						? "notice.cardAdded"
						: change.kind === "edit"
							? "notice.cardSaved"
							: "notice.cardDeleted",
				),
			);
			return true;
		} catch (error) {
			this.fail(interaction, change.kind, this.errorMessage(error));
			return false;
		}
	}

	private fail(interaction: Interaction, kind: PluginCardChange["kind"], message: string): void {
		if (!this.isCurrent(interaction)) return;
		if (this.snapshot.editor)
			this.publish({ ...this.snapshot, editor: { ...this.snapshot.editor, error: message } });
		this.options.notify(
			this.t(kind === "delete" ? "notice.cardDeleteFailed" : "notice.cardSaveFailed", {
				message,
			}),
		);
	}

	private errorMessage(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}

	private begin(): Interaction | null {
		if (!this.lease) return null;
		this.invalidate();
		const interaction = { id: ++this.nextId, controller: new AbortController() };
		this.current = interaction;
		return interaction;
	}

	private isCurrent(interaction: Interaction): boolean {
		return (
			this.lease !== null &&
			this.current === interaction &&
			!interaction.controller.signal.aborted
		);
	}

	private invalidate(): void {
		const previous = this.current;
		this.current = null;
		previous?.controller.abort();
		this.publish({ editor: null, preparing: false });
	}

	private publish(snapshot: CardEditingSnapshot): void {
		this.snapshot = Object.freeze({
			...snapshot,
			editor: snapshot.editor ? Object.freeze(snapshot.editor) : null,
		});
		for (const listener of this.listeners) listener();
	}
}
