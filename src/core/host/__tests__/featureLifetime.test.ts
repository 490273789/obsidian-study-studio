import { describe, expect, it } from "vitest";
import {
	defineFeatureLifetime,
	FeatureLifetimeError,
	type FeatureLifetimeScope,
} from "../featureLifetime";
import { createFakeWorkbenchHost } from "./fakeWorkbenchHost";

function expectLifetimeError(
	error: unknown,
	code: FeatureLifetimeError["code"],
): FeatureLifetimeError {
	expect(error).toBeInstanceOf(FeatureLifetimeError);
	const lifetimeError = error as FeatureLifetimeError;
	expect(lifetimeError.code).toBe(code);
	return lifetimeError;
}

describe("defineFeatureLifetime", () => {
	it("starts once, refreshes immediately, and reuses the same host", () => {
		const first = createFakeWorkbenchHost("dictionary");
		const second = createFakeWorkbenchHost("dictionary");
		const calls: string[] = [];
		const module = defineFeatureLifetime({
			id: "dictionary",
			start(host) {
				calls.push(`start:${host === first.host}`);
				return () => calls.push("refresh");
			},
		});

		module.render(first.host);
		module.render(first.host);

		expect(calls).toEqual(["start:true", "refresh", "refresh"]);
		expect(() => module.render(second.host)).toThrowError(
			expect.objectContaining({ code: "host-changed" }),
		);
	});

	it("closes resource registration after synchronous start", () => {
		const fake = createFakeWorkbenchHost("dictionary");
		let lifetime: FeatureLifetimeScope | undefined;
		const module = defineFeatureLifetime({
			id: "dictionary",
			start(_host, scope) {
				lifetime = scope;
			},
		});

		module.render(fake.host);

		try {
			lifetime!.defer(() => undefined);
			expect.unreachable("defer should reject after start");
		} catch (error) {
			expectLifetimeError(error, "invalid-phase");
		}
	});

	it("rolls back acquired resources in LIFO order when start fails", () => {
		const fake = createFakeWorkbenchHost("dictionary");
		const releases: string[] = [];
		const startFailure = new Error("cannot start");
		const module = defineFeatureLifetime({
			id: "dictionary",
			start(_host, lifetime) {
				lifetime.defer(() => releases.push("first"));
				lifetime.defer(() => releases.push("second"));
				throw startFailure;
			},
		});

		try {
			module.render(fake.host);
			expect.unreachable("start should fail");
		} catch (error) {
			const lifetimeError = expectLifetimeError(error, "start-failed");
			expect(lifetimeError.errors).toEqual([startFailure]);
		}
		expect(releases).toEqual(["second", "first"]);
		expect(() => module.render(fake.host)).toThrowError(
			expect.objectContaining({ code: "failed" }),
		);
	});

	it("retains the start failure and every rollback failure", () => {
		const fake = createFakeWorkbenchHost("dictionary");
		const startFailure = new Error("cannot start");
		const secondReleaseFailure = new Error("second release failed");
		const firstReleaseFailure = new Error("first release failed");
		const module = defineFeatureLifetime({
			id: "dictionary",
			start(_host, lifetime) {
				lifetime.defer(() => {
					throw firstReleaseFailure;
				});
				lifetime.defer(() => {
					throw secondReleaseFailure;
				});
				throw startFailure;
			},
		});

		try {
			module.render(fake.host);
			expect.unreachable("start should fail");
		} catch (error) {
			const lifetimeError = expectLifetimeError(error, "start-failed");
			expect(lifetimeError.errors).toEqual([
				startFailure,
				secondReleaseFailure,
				firstReleaseFailure,
			]);
		}
	});

	it("keeps the lifetime started when refresh fails, so a later refresh can recover", () => {
		const fake = createFakeWorkbenchHost("dictionary");
		let starts = 0;
		let refreshes = 0;
		const module = defineFeatureLifetime({
			id: "dictionary",
			start() {
				starts += 1;
				return () => {
					refreshes += 1;
					if (refreshes === 1) throw new Error("temporary failure");
				};
			},
		});

		try {
			module.render(fake.host);
			expect.unreachable("first refresh should fail");
		} catch (error) {
			expectLifetimeError(error, "refresh-failed");
		}
		module.render(fake.host);

		expect(starts).toBe(1);
		expect(refreshes).toBe(2);
	});

	it("releases all resources in LIFO order, aggregates failures, and becomes terminal", () => {
		const fake = createFakeWorkbenchHost("dictionary");
		const releases: string[] = [];
		const releaseFailure = new Error("release failed");
		const module = defineFeatureLifetime({
			id: "dictionary",
			start(_host, lifetime) {
				lifetime.own({ dispose: () => releases.push("disposable") });
				lifetime.defer(() => {
					releases.push("failing");
					throw releaseFailure;
				});
				lifetime.own("custom", (value) => releases.push(value));
			},
		});

		module.render(fake.host);
		try {
			module.stop();
			expect.unreachable("release should report its failure");
		} catch (error) {
			const lifetimeError = expectLifetimeError(error, "dispose-failed");
			expect(lifetimeError.errors).toEqual([releaseFailure]);
		}

		expect(releases).toEqual(["custom", "failing", "disposable"]);
		expect(() => module.stop()).not.toThrow();
		expect(() => module.render(fake.host)).toThrowError(
			expect.objectContaining({ code: "stopped" }),
		);
	});
});
