import type { FeatureSettingsOwner } from "./settingsSlices";
import type { WorkbenchHost, WorkbenchModule } from "./workbench";

export type FeatureLifetimeErrorCode =
	| "invalid-phase"
	| "host-changed"
	| "start-failed"
	| "refresh-failed"
	| "dispose-failed"
	| "stopped"
	| "failed";

/** A stable failure reported by the feature-lifetime adapter. */
export class FeatureLifetimeError extends Error {
	readonly errors: readonly unknown[];

	constructor(code: FeatureLifetimeErrorCode, message: string, errors: readonly unknown[] = []) {
		super(message);
		this.name = "FeatureLifetimeError";
		this.code = code;
		this.errors = errors;
	}

	readonly code: FeatureLifetimeErrorCode;
}

export interface FeatureLifetimeScope {
	/** Registers an owned disposable resource and returns it unchanged. */
	own<T extends { dispose(): void }>(resource: T): T;
	/** Registers a resource with feature-specific release behavior. */
	own<T>(resource: T, release: (resource: T) => void): T;
	/** Registers a release action for a resource that has no disposable shape. */
	defer(release: () => void): void;
}

export interface FeatureLifetimeDefinition<TOwner extends FeatureSettingsOwner> {
	readonly id: TOwner;
	/**
	 * Acquires resources and publishes one-time declarations. Its optional return
	 * value receives every settings-driven refresh, including the first render.
	 */
	start(host: WorkbenchHost<TOwner>, lifetime: FeatureLifetimeScope): (() => void) | void;
}

type LifetimeState = "idle" | "starting" | "started" | "stopped" | "failed";

interface RegisteredRelease {
	release(): void;
}

/**
 * Turns a one-time feature setup plus refresh callback into the workbench's
 * existing idempotent module seam. The adapter owns the lifecycle state machine
 * so features only describe acquisition, refresh, and release ownership.
 */
export function defineFeatureLifetime<TOwner extends FeatureSettingsOwner>(
	definition: FeatureLifetimeDefinition<TOwner>,
): WorkbenchModule<TOwner> {
	let state: LifetimeState = "idle";
	let host: WorkbenchHost<TOwner> | null = null;
	let refresh: (() => void) | undefined;
	let scopeOpen = false;
	const releases: RegisteredRelease[] = [];

	const assertScopeOpen = (): void => {
		if (!scopeOpen) {
			throw new FeatureLifetimeError(
				"invalid-phase",
				"Feature lifetime resources may only be registered during start",
			);
		}
	};

	function own<T extends { dispose(): void }>(resource: T): T;
	function own<T>(resource: T, release: (resource: T) => void): T;
	function own<T>(resource: T, release?: (resource: T) => void): T {
		assertScopeOpen();
		if (release) {
			releases.push({ release: () => release(resource) });
			return resource;
		}
		const disposable = resource as T & { dispose?: () => void };
		if (typeof disposable.dispose !== "function") {
			throw new FeatureLifetimeError(
				"invalid-phase",
				"Feature lifetime own(resource) requires a dispose method",
			);
		}
		releases.push({ release: () => disposable.dispose!() });
		return resource;
	}

	const lifetime: FeatureLifetimeScope = {
		own,
		defer(release: () => void): void {
			assertScopeOpen();
			releases.push({ release });
		},
	};

	const releaseAll = (): readonly unknown[] => {
		const errors: unknown[] = [];
		for (let index = releases.length - 1; index >= 0; index -= 1) {
			const registered = releases[index];
			if (!registered) continue;
			try {
				registered.release();
			} catch (error) {
				errors.push(error);
			}
		}
		releases.length = 0;
		return errors;
	};

	const ensureHost = (nextHost: WorkbenchHost<TOwner>): void => {
		if (host && host !== nextHost) {
			throw new FeatureLifetimeError(
				"host-changed",
				"A feature lifetime must keep the host from its first render",
			);
		}
	};

	const render = (nextHost: WorkbenchHost<TOwner>): void => {
		if (state === "stopped") {
			throw new FeatureLifetimeError("stopped", "This feature lifetime has been stopped");
		}
		if (state === "failed") {
			throw new FeatureLifetimeError("failed", "This feature lifetime failed to start");
		}
		if (state === "starting") {
			throw new FeatureLifetimeError(
				"invalid-phase",
				"Feature lifetime start is already in progress",
			);
		}
		ensureHost(nextHost);

		if (state === "idle") {
			state = "starting";
			host = nextHost;
			scopeOpen = true;
			try {
				refresh = definition.start(nextHost, lifetime) ?? undefined;
			} catch (error) {
				scopeOpen = false;
				state = "failed";
				const releaseErrors = releaseAll();
				throw new FeatureLifetimeError(
					"start-failed",
					`Feature lifetime ${definition.id} failed to start`,
					[error, ...releaseErrors],
				);
			}
			scopeOpen = false;
			state = "started";
		}

		try {
			refresh?.();
		} catch (error) {
			throw new FeatureLifetimeError(
				"refresh-failed",
				`Feature lifetime ${definition.id} failed to refresh`,
				[error],
			);
		}
	};

	return {
		id: definition.id,
		render,
		stop(): void {
			if (state === "stopped" || state === "failed") return;
			if (state === "starting") {
				throw new FeatureLifetimeError(
					"invalid-phase",
					"Feature lifetime cannot stop while start is in progress",
				);
			}
			state = "stopped";
			const errors = releaseAll();
			if (errors.length > 0) {
				throw new FeatureLifetimeError(
					"dispose-failed",
					`Feature lifetime ${definition.id} failed to release resources`,
					errors,
				);
			}
		},
	};
}
