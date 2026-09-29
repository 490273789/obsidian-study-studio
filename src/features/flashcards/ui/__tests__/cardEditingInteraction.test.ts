import { describe, expect, it, vi } from "vitest";
import { createEmptyCard } from "ts-fsrs";
import type { ViewState } from "../../../../core/shared/types";
import type {
	CardChangeOutcome,
	CardEditPreparation,
	CardIdentityContinuity,
} from "../../domain/identity/cardIdentityContinuity";
import { CardEditingInteraction } from "../cardEditingInteraction";
import type { FlashcardConfirmation, FlashcardNavigationSnapshot } from "../flashcardNavigation";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function ready(cardId: string, front = "front"): CardEditPreparation {
	return {
		kind: "ready",
		card: {
			id: cardId,
			front,
			back: "back",
			sourceFile: "deck.md",
			indexInFile: 0,
			fsrsCard: createEmptyCard(),
		},
	};
}

class NavigationDouble {
	private snapshot: FlashcardNavigationSnapshot = {
		view: { type: "home" },
		busy: false,
		confirmation: null,
	};
	private readonly listeners = new Set<() => void>();
	readonly migration = vi.fn<(deckId?: string, signal?: AbortSignal) => Promise<boolean>>();
	confirmHandler: (
		content: FlashcardConfirmation,
		execute: () => Promise<void>,
		signal?: AbortSignal,
	) => Promise<void> = async (_content, execute) => execute();

	getSnapshot = (): FlashcardNavigationSnapshot => this.snapshot;
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};
	requestMigration = (deckId?: string, signal?: AbortSignal): Promise<boolean> =>
		this.migration(deckId, signal);
	confirm = (
		content: FlashcardConfirmation,
		execute: () => Promise<void>,
		signal?: AbortSignal,
	): Promise<void> => this.confirmHandler(content, execute, signal);

	navigate(view: ViewState): void {
		this.snapshot = { ...this.snapshot, view };
		for (const listener of this.listeners) listener();
	}
}

function mounted(options: {
	prepare?: (deckId: string, cardId: string) => Promise<CardEditPreparation>;
	change?: (
		change: Parameters<CardIdentityContinuity["change"]>[0],
	) => Promise<CardChangeOutcome>;
	migration?: boolean;
}) {
	const prepare = vi.fn(options.prepare ?? (async (_deckId, cardId) => ready(cardId)));
	const change = vi.fn<CardIdentityContinuity["change"]>(
		options.change ?? (async () => ({ kind: "applied" })),
	);
	const navigation = new NavigationDouble();
	navigation.migration.mockResolvedValue(options.migration ?? true);
	const notify = vi.fn();
	const interaction = new CardEditingInteraction({
		continuity: { prepareEdit: prepare, change },
		navigation,
		notify,
		language: "en",
	});
	const cleanup = interaction.mount();
	return { interaction, cleanup, prepare, change, navigation, notify };
}

const draft = { deckId: " deck.md ", front: " front ", back: " back ", explanation: " note " };

describe("CardEditingInteraction", () => {
	it("keeps only the latest edit preparation and suppresses stale outcomes", async () => {
		const first = deferred<CardEditPreparation>();
		const second = deferred<CardEditPreparation>();
		const { interaction, prepare, notify } = mounted({
			prepare: async (_deckId, cardId) => (cardId === "old" ? first.promise : second.promise),
		});

		const old = interaction.openEdit("deck.md", "old");
		const current = interaction.openEdit("deck.md", "current");
		second.resolve(ready("current", "new front"));
		await current;
		first.resolve({ kind: "not-found" });
		await old;

		expect(prepare).toHaveBeenCalledTimes(2);
		expect(interaction.getSnapshot().editor).toMatchObject({
			cardId: "current",
			front: "new front",
		});
		expect(notify).not.toHaveBeenCalled();
	});

	it.each<CardEditPreparation>([
		ready("old", "obsolete front"),
		{ kind: "not-found" },
		{ kind: "blocked", reason: "migration-required" },
		{ kind: "blocked", reason: "source-needs-repair" },
	])("ignores stale $kind preparation after a newer editor is opened", async (outcome) => {
		const prepared = deferred<CardEditPreparation>();
		const { interaction, navigation, notify } = mounted({ prepare: () => prepared.promise });
		const opening = interaction.openEdit("deck.md", "old");
		interaction.openCreate("new.md");
		const snapshot = interaction.getSnapshot();
		prepared.resolve(outcome);
		await opening;
		expect(interaction.getSnapshot()).toBe(snapshot);
		expect(navigation.migration).not.toHaveBeenCalled();
		expect(notify).not.toHaveBeenCalled();
	});

	it("reports a current preparation failure but drops stale rejections after a route change", async () => {
		const late = deferred<CardEditPreparation>();
		const { interaction, prepare, navigation, notify } = mounted({
			prepare: async (_deckId, cardId) =>
				cardId === "late" ? late.promise : Promise.reject(new Error("broken")),
		});

		await interaction.openEdit("deck.md", "broken");
		expect(notify).toHaveBeenCalledWith("Could not open the card editor: broken");

		const pending = interaction.openEdit("deck.md", "late");
		navigation.navigate({ type: "stats" });
		late.reject(new Error("obsolete"));
		await pending;
		expect(notify).not.toHaveBeenCalledWith("Could not open the card editor: obsolete");
		expect(interaction.getSnapshot()).toEqual({ editor: null, preparing: false });
		expect(prepare).toHaveBeenCalledTimes(2);
	});

	it("suppresses late preparation after unmount and a later remount", async () => {
		const pending = deferred<CardEditPreparation>();
		const { interaction, cleanup } = mounted({ prepare: async () => pending.promise });
		const open = interaction.openEdit("deck.md", "one");
		cleanup();
		interaction.mount();
		pending.resolve(ready("one"));
		await open;
		expect(interaction.getSnapshot()).toEqual({ editor: null, preparing: false });
	});

	it("normalizes create and edit requests, keeps a failed editor, and permits retry", async () => {
		let attempt = 0;
		const { interaction, change, notify } = mounted({
			change: async () => {
				attempt += 1;
				return attempt === 1
					? { kind: "failed", retryable: true, message: "write failed" }
					: { kind: "applied", cardIdentity: "new" };
			},
		});
		interaction.openCreate(null);
		expect(notify).toHaveBeenCalledWith("No available deck to add cards to");

		interaction.openCreate("fixed.md");
		const createId = interaction.getSnapshot().editor!.id;
		await interaction.save(createId, draft);
		expect(change).toHaveBeenNthCalledWith(1, {
			kind: "add",
			deckId: "deck.md",
			content: { front: "front", back: "back", explanation: "note" },
		});
		expect(interaction.getSnapshot().editor).toMatchObject({
			id: createId,
			saving: false,
			error: "write failed",
		});

		await interaction.save(createId, draft);
		expect(interaction.getSnapshot().editor).toBeNull();
		expect(notify).toHaveBeenCalledWith("Card added");

		await interaction.openEdit("fixed.md", "card");
		const editId = interaction.getSnapshot().editor!.id;
		await interaction.save(editId, draft);
		expect(change).toHaveBeenLastCalledWith({
			kind: "edit",
			deckId: "fixed.md",
			cardIdentity: "card",
			content: { front: "front", back: "back", explanation: "note" },
		});
	});

	it("accepts one save at a time and makes old editor ids inert", async () => {
		const write = deferred<CardChangeOutcome>();
		const { interaction, change } = mounted({ change: async () => write.promise });
		interaction.openCreate("deck.md");
		const editorId = interaction.getSnapshot().editor!.id;
		const first = interaction.save(editorId, draft);
		const second = interaction.save(editorId, draft);
		expect(change).toHaveBeenCalledTimes(1);
		interaction.close(editorId);
		expect(interaction.getSnapshot().editor).toMatchObject({ id: editorId, saving: true });

		write.resolve({ kind: "applied" });
		await Promise.all([first, second]);
		interaction.openCreate("deck.md");
		const newerId = interaction.getSnapshot().editor!.id;
		await interaction.save(editorId, draft);
		interaction.close(editorId);
		expect(change).toHaveBeenCalledTimes(1);
		expect(interaction.getSnapshot().editor?.id).toBe(newerId);
	});

	it.each<CardChangeOutcome>([
		{ kind: "applied" },
		{ kind: "failed", retryable: true, message: "too late" },
		{ kind: "blocked", reason: "migration-required" },
	])(
		"allows an old write to finish with $kind without affecting a new editor",
		async (outcome) => {
			const oldWrite = deferred<CardChangeOutcome>();
			const { interaction, change, notify, navigation } = mounted({
				change: async () => oldWrite.promise,
			});
			interaction.openCreate("deck.md");
			const oldId = interaction.getSnapshot().editor!.id;
			const saving = interaction.save(oldId, draft);
			interaction.openCreate("new.md");
			const newId = interaction.getSnapshot().editor!.id;
			oldWrite.resolve(outcome);
			await saving;

			expect(change).toHaveBeenCalledTimes(1);
			expect(interaction.getSnapshot().editor).toMatchObject({
				id: newId,
				deckId: "new.md",
				saving: false,
				error: null,
			});
			expect(notify).not.toHaveBeenCalled();
			expect(navigation.migration).not.toHaveBeenCalled();
		},
	);

	it("retains the editor after migration regardless of its result and never retries the write", async () => {
		for (const migrated of [true, false]) {
			const { interaction, change, navigation } = mounted({
				migration: migrated,
				change: async () => ({ kind: "blocked", reason: "migration-required" }),
			});
			interaction.openCreate("deck.md");
			const editorId = interaction.getSnapshot().editor!.id;
			await interaction.save(editorId, draft);
			expect(change).toHaveBeenCalledTimes(1);
			expect(navigation.migration).toHaveBeenCalledWith("deck.md", expect.any(AbortSignal));
			expect(interaction.getSnapshot().editor).toMatchObject({
				id: editorId,
				saving: false,
				error: null,
			});
		}
	});

	it("writes deletes only after confirmation, and ignores a stale confirmation continuation", async () => {
		const { interaction, change, navigation } = mounted({});
		navigation.confirmHandler = async () => undefined;
		await interaction.delete("deck.md", "card");
		expect(change).not.toHaveBeenCalled();

		let execute: (() => Promise<void>) | undefined;
		navigation.confirmHandler = async (_content, callback) => {
			execute = callback;
		};
		const deleting = interaction.delete("deck.md", "card");
		await Promise.resolve();
		interaction.openCreate("deck.md");
		await execute!();
		await deleting;
		expect(change).not.toHaveBeenCalled();

		navigation.confirmHandler = async (_content, callback) => callback();
		await interaction.delete("deck.md", "card");
		expect(change).toHaveBeenCalledWith({
			kind: "delete",
			deckId: "deck.md",
			cardIdentity: "card",
		});
	});

	it.each([true, false])(
		"requires a fresh edit request after migration resolves %s",
		async (migration) => {
			const { interaction, prepare, navigation, change } = mounted({
				prepare: async () => ({ kind: "blocked", reason: "migration-required" }),
				migration,
			});
			await interaction.openEdit("deck.md", "old");
			expect(prepare).toHaveBeenCalledTimes(1);
			expect(navigation.migration).toHaveBeenCalledTimes(1);
			expect(interaction.getSnapshot()).toEqual({ editor: null, preparing: false });
			expect(change).not.toHaveBeenCalled();
		},
	);

	it("cancels the old migration prompt without changing the new editor", async () => {
		const migration = deferred<boolean>();
		const { interaction, navigation } = mounted({
			change: async () => ({ kind: "blocked", reason: "migration-required" }),
		});
		navigation.migration.mockReturnValue(migration.promise);
		interaction.openCreate("deck.md");
		const saving = interaction.save(interaction.getSnapshot().editor!.id, draft);
		await Promise.resolve();
		const signal = navigation.migration.mock.calls[0]![1]!;
		expect(signal.aborted).toBe(false);
		interaction.openCreate("new.md");
		const snapshot = interaction.getSnapshot();
		expect(signal.aborted).toBe(true);
		migration.resolve(true);
		await saving;
		expect(interaction.getSnapshot()).toBe(snapshot);
	});

	it("keeps a failed draft's editor mounted and recovers from a rejected write", async () => {
		const { interaction, change } = mounted({
			change: async () => {
				throw new Error("offline");
			},
		});
		interaction.openCreate("deck.md");
		const id = interaction.getSnapshot().editor!.id;
		await interaction.save(id, { ...draft, deckId: " " });
		expect(change).not.toHaveBeenCalled();
		expect(interaction.getSnapshot().editor?.error).toBeTruthy();
		await interaction.save(id, draft);
		expect(interaction.getSnapshot().editor).toMatchObject({
			id,
			saving: false,
			error: "offline",
		});
		interaction.close(id);
		expect(interaction.getSnapshot().editor).toBeNull();
	});

	it("suppresses a write's late rejection after cleanup and ignores an old cleanup after remount", async () => {
		const write = deferred<CardChangeOutcome>();
		const { interaction, cleanup, notify } = mounted({ change: () => write.promise });
		interaction.openCreate("deck.md");
		const saving = interaction.save(interaction.getSnapshot().editor!.id, draft);
		cleanup();
		const release = interaction.mount();
		interaction.openCreate("new.md");
		const snapshot = interaction.getSnapshot();
		cleanup();
		write.reject(new Error("obsolete"));
		await saving;
		expect(interaction.getSnapshot()).toBe(snapshot);
		expect(notify).not.toHaveBeenCalled();
		release();
	});

	it("keeps deletion explicit after a migration and catches confirmation failures", async () => {
		const { interaction, navigation, change, notify } = mounted({
			change: async () => ({ kind: "blocked", reason: "migration-required" }),
		});
		await interaction.delete("deck.md", "card");
		expect(change).toHaveBeenCalledTimes(1);
		expect(navigation.migration).toHaveBeenCalledTimes(1);
		navigation.confirmHandler = async () => {
			throw new Error("confirmation failed");
		};
		await interaction.delete("deck.md", "card");
		expect(change).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenCalledWith("Delete failed: confirmation failed");
	});
});
