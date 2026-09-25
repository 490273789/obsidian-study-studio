import type { Language, ViewState } from "../../../core/shared/types";
import type { DeckHome, DeckHomeDestination, DeckHomeOutcome } from "../domain/decks/deckHome";
import {
	getRestartViewState,
	type LifecycleOutcome,
	type LifecycleReference,
	type SessionLifecycle,
	type SessionStartRequest,
} from "../domain/sessions/sessionLifecycle";
import { createTranslator } from "../strings";

type ActiveReference = Extract<LifecycleReference, { kind: "active" }>;
type ResultReference = Extract<LifecycleReference, { kind: "result" }>;

export interface FlashcardConfirmation {
	readonly title: string;
	readonly message: string;
	readonly confirmText: string;
	readonly tone: "primary" | "danger";
}

export interface FlashcardNavigationSnapshot {
	readonly view: Readonly<ViewState>;
	readonly confirmation: (FlashcardConfirmation & { readonly id: number }) | null;
}

export interface FlashcardNavigationOptions {
	readonly lifecycle: SessionLifecycle;
	readonly home: Pick<DeckHome, "act">;
	readonly ownerId: string;
	readonly language?: Language;
	readonly notify: (message: string) => void;
}

interface ConfirmationRequest {
	readonly lease: object;
	readonly id: number;
}

interface PendingConfirmation {
	readonly request: ConfirmationRequest;
	readonly content: FlashcardConfirmation;
	readonly reference?: ActiveReference;
	readonly resolve: (confirmed: boolean) => void;
}

/** View-local coordination; session state and durable transitions stay in the lifecycle. */
export class FlashcardNavigation {
	private t: ReturnType<typeof createTranslator>;
	private lease: object | null = null;
	private unsubscribe: (() => void) | null = null;
	private readonly listeners = new Set<() => void>();
	private navigationVersion = 0;
	private lifecycleOperation: object | null = null;
	private confirmationVersion = 0;
	private pending: PendingConfirmation | null = null;
	private lastEndNotice: string | null = null;
	private snapshot: FlashcardNavigationSnapshot = Object.freeze({
		view: Object.freeze({ type: "home" as const }),
		confirmation: null,
	});

	constructor(private readonly options: FlashcardNavigationOptions) {
		this.t = createTranslator(options.language ?? "zh");
	}

	getSnapshot = (): FlashcardNavigationSnapshot => this.snapshot;
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	setLanguage(language: Language): void {
		this.t = createTranslator(language);
	}

	/** A reversible view lease supports effect cleanup/setup without ending a session. */
	mount(): () => void {
		this.release();
		const lease = {};
		this.lease = lease;
		this.unsubscribe = this.options.lifecycle.subscribe(this.lifecycleChanged);
		this.lifecycleChanged();
		return () => {
			if (this.lease === lease) this.release();
		};
	}

	home = (): void => this.show({ type: "home" });
	stats = (): void => this.show({ type: "stats" });

	async navigate(destination: DeckHomeDestination, deckId: string): Promise<void> {
		const lease = this.lease;
		if (!lease) return;
		const version = ++this.navigationVersion;
		const reference = this.options.lifecycle.getSnapshot().reference;
		const outcome = await this.options.home.act({ kind: "navigate", destination, deckId });
		if (!this.isNavigationCurrent(lease, version) || !this.matches(reference)) return;
		if (outcome.kind !== "navigation") {
			this.reportHomeOutcome(outcome);
			return;
		}
		this.publishView({
			type:
				outcome.destination === "word-list" ? "word-list" : `${outcome.destination}-setup`,
			deckId: outcome.deckId,
		});
	}

	start = async (request: SessionStartRequest): Promise<void> => {
		const lease = this.lease;
		if (!lease || this.lifecycleOperation) return;
		const version = ++this.navigationVersion;
		const outcome = await this.runLifecycle(() => this.options.lifecycle.start(request));
		if (!this.isNavigationCurrent(lease, version) || !this.matches(outcome.snapshot.reference))
			return;
		const fallback =
			request.mode === "study"
				? this.t("notice.todayComplete")
				: request.mode === "spelling" && request.selection.kind === "study-day"
					? this.t("spelling.dayInvalid")
					: this.t("notice.deckEmpty");
		this.reportLifecycleOutcome(outcome, fallback);
	};

	async exit(reference: ActiveReference): Promise<void> {
		if (this.lifecycleOperation || !this.matches(reference)) return;
		const request = this.beginConfirmation();
		if (!request) return;
		const version = ++this.navigationVersion;
		const confirmed = await this.ask(
			request,
			{
				title: this.t(`${reference.mode}.exitTitle`),
				message: this.t(`${reference.mode}.exitConfirm`),
				confirmText: this.t("common.confirm"),
				tone: "danger",
			},
			reference,
		);
		if (
			!confirmed ||
			!this.isConfirmationCurrent(request) ||
			!this.matches(reference) ||
			this.lifecycleOperation
		)
			return;
		const outcome = await this.runLifecycle(() =>
			this.options.lifecycle.act(reference, { kind: "exit" }),
		);
		if (
			!this.isNavigationCurrent(request.lease, version) ||
			!this.matches(outcome.snapshot.reference)
		)
			return;
		if (this.reportLifecycleOutcome(outcome)) this.publishView({ type: "home" });
	}

	async result(
		reference: ResultReference,
		action: "home" | "restart" | "retry-incorrect",
	): Promise<void> {
		const lease = this.lease;
		const result = this.options.lifecycle.getSnapshot();
		if (
			!lease ||
			this.lifecycleOperation ||
			result.kind !== "result" ||
			!this.matches(reference)
		)
			return;
		const version = ++this.navigationVersion;
		const outcome = await this.runLifecycle(() =>
			this.options.lifecycle.act(reference, {
				kind: action === "retry-incorrect" ? "retry-incorrect" : "dismiss",
			}),
		);
		if (!this.isNavigationCurrent(lease, version) || !this.matches(outcome.snapshot.reference))
			return;
		if (!this.reportLifecycleOutcome(outcome) || action === "retry-incorrect") return;
		this.publishView(
			action === "restart" ? getRestartViewState(result.setupDefaults) : { type: "home" },
		);
	}

	/** Card mutation stays with its existing workflow; only the confirmation lease is owned here. */
	async confirm(content: FlashcardConfirmation, execute: () => Promise<void>): Promise<void> {
		const request = this.beginConfirmation();
		if (!request) return;
		if ((await this.ask(request, content)) && this.isConfirmationCurrent(request))
			await execute();
	}

	respond(id: number, confirmed: boolean): void {
		if (this.pending?.request.id !== id) return;
		const pending = this.pending;
		this.finishConfirmation(
			confirmed && (!pending.reference || this.matches(pending.reference)),
		);
	}

	requestMigration = async (deckId?: string): Promise<boolean> => {
		const request = this.beginConfirmation();
		if (!request) return false;
		const prepared = await this.options.home.act({
			kind: "request-migration",
			ownerId: this.options.ownerId,
			deckId,
		});
		if (prepared.kind !== "confirmation-required") {
			if (this.isConfirmationCurrent(request) && prepared.kind === "rejected") {
				if (prepared.reason === "migration-unavailable") {
					this.options.notify(
						this.t(deckId ? "identity.editNeedsMigration" : "identity.noMigration"),
					);
				} else if (prepared.reason === "busy")
					this.options.notify(this.t("identity.sourceChanging"));
			}
			return false;
		}
		const confirmed =
			this.isConfirmationCurrent(request) &&
			(await this.ask(request, {
				title: this.t("identity.migrationTitle"),
				message:
					prepared.scope.kind === "all"
						? this.t("identity.migrationDescription", {
								sources: prepared.sourceCount,
								cards: prepared.cardCount,
							})
						: this.t("identity.editMigrationDescription", {
								deckName: prepared.deckName ?? prepared.scope.deckId,
								cards: prepared.cardCount,
							}),
				confirmText: this.t(
					prepared.scope.kind === "all"
						? "identity.migrateAllNow"
						: "identity.migrateNow",
				),
				tone: "primary",
			}));
		// Even a late preparation must release its exact continuation, not a newer owner's work.
		const outcome = await this.options.home.act({
			kind: "continue",
			ownerId: this.options.ownerId,
			continuation: prepared.continuation,
			confirmed: confirmed && this.isConfirmationCurrent(request),
		});
		return this.isConfirmationCurrent(request) && outcome.kind === "applied";
	};

	private beginConfirmation(): ConfirmationRequest | null {
		if (!this.lease) return null;
		const request = { lease: this.lease, id: ++this.confirmationVersion };
		this.finishConfirmation(false);
		return request;
	}

	private ask(
		request: ConfirmationRequest,
		content: FlashcardConfirmation,
		reference?: ActiveReference,
	): Promise<boolean> {
		if (!this.isConfirmationCurrent(request)) return Promise.resolve(false);
		return new Promise((resolve) => {
			this.pending = { request, content, reference, resolve };
			this.publishConfirmation(Object.freeze({ ...content, id: request.id }));
		});
	}

	private finishConfirmation(confirmed: boolean): void {
		const pending = this.pending;
		if (!pending) return;
		this.pending = null;
		this.publishConfirmation(null);
		pending.resolve(confirmed);
	}

	private lifecycleChanged = (): void => {
		if (!this.lease) return;
		const snapshot = this.options.lifecycle.getSnapshot();
		if (this.pending?.reference && !this.matches(this.pending.reference)) {
			this.finishConfirmation(false);
		}
		if (snapshot.kind !== "idle" || !snapshot.lastEnd) return;
		const noticeId = snapshot.lastEnd.id;
		if (this.lastEndNotice !== noticeId) {
			this.lastEndNotice = noticeId;
			this.show({ type: "home" });
			this.options.notify(this.t("identity.sessionEndedBySourceChange"));
		}
		const lease = this.lease;
		// Let all mounted views see the termination before consuming the shared notice.
		queueMicrotask(() => {
			if (this.lease !== lease || !this.matches(snapshot.reference)) return;
			void this.options.lifecycle.act(snapshot.reference, {
				kind: "acknowledge-end",
				noticeId,
			});
		});
	};

	private release(): void {
		if (!this.lease) return;
		this.lease = null;
		this.lifecycleOperation = null;
		this.navigationVersion++;
		this.confirmationVersion++;
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.finishConfirmation(false);
		void this.options.home.act({ kind: "release-owner", ownerId: this.options.ownerId });
	}

	/** Duplicate clicks must not supersede the navigation belonging to an in-flight commit. */
	private async runLifecycle(
		operation: () => Promise<LifecycleOutcome>,
	): Promise<LifecycleOutcome> {
		const token = {};
		this.lifecycleOperation = token;
		try {
			return await operation();
		} finally {
			if (this.lifecycleOperation === token) this.lifecycleOperation = null;
		}
	}

	private isConfirmationCurrent(request: ConfirmationRequest): boolean {
		return this.lease === request.lease && this.confirmationVersion === request.id;
	}

	private isNavigationCurrent(lease: object, version: number): boolean {
		return this.lease === lease && this.navigationVersion === version;
	}

	private matches(reference: LifecycleReference): boolean {
		const current = this.options.lifecycle.getSnapshot().reference;
		return (
			reference.key === current.key &&
			reference.revision === current.revision &&
			reference.kind === current.kind &&
			(!("mode" in reference) || ("mode" in current && reference.mode === current.mode))
		);
	}

	private show(view: ViewState): void {
		if (!this.lease) return;
		this.navigationVersion++;
		this.confirmationVersion++;
		this.finishConfirmation(false);
		this.publishView(view);
	}

	private publishView(view: ViewState): void {
		this.snapshot = Object.freeze({ ...this.snapshot, view: freezeView(view) });
		this.publish();
	}

	private publishConfirmation(confirmation: FlashcardNavigationSnapshot["confirmation"]): void {
		this.snapshot = Object.freeze({ ...this.snapshot, confirmation });
		this.publish();
	}

	private publish(): void {
		for (const listener of this.listeners) listener();
	}

	private reportLifecycleOutcome(outcome: LifecycleOutcome, noEligibleMessage?: string): boolean {
		if (outcome.kind === "applied") return true;
		if (outcome.kind === "failed") this.options.notify(outcome.failure.message);
		else if (outcome.reason === "no-eligible-cards" && noEligibleMessage)
			this.options.notify(noEligibleMessage);
		else if (outcome.reason === "spelling-not-enabled")
			this.options.notify(this.t("spelling.deckNotEnabled"));
		else if (outcome.reason === "stable-card-identity-required")
			this.options.notify(this.t("spelling.identityRequired"));
		else if (outcome.reason === "no-retryable-cards")
			this.options.notify(this.t("session.noRetryCards"));
		return false;
	}

	private reportHomeOutcome(outcome: DeckHomeOutcome): void {
		if (outcome.kind !== "rejected") return;
		switch (outcome.reason) {
			case "deck-missing":
				this.options.notify(this.t("notice.deckMissing"));
				break;
			case "deck-empty":
				this.options.notify(this.t("notice.deckEmpty"));
				break;
			case "spelling-not-enabled":
				this.options.notify(this.t("spelling.deckNotEnabled"));
				break;
			case "spelling-invalid":
				this.options.notify(this.t("spelling.deckInvalid"));
				break;
			case "stable-card-identity-required":
				this.options.notify(this.t("spelling.identityRequired"));
				break;
		}
	}
}

function freezeView(view: ViewState): Readonly<ViewState> {
	if (view.type === "practice-setup" && view.initialSelection) {
		return Object.freeze({
			...view,
			initialSelection: Object.freeze({ ...view.initialSelection }),
		});
	}
	if (view.type === "spelling-setup" && view.initialSelection) {
		return Object.freeze({
			...view,
			initialSelection: Object.freeze({ ...view.initialSelection }),
		});
	}
	return Object.freeze({ ...view });
}
