import { describe, expect, it, vi } from "vitest";
import { VideoPlayerPresenterLease } from "../presenterLease";

describe("VideoPlayerPresenterLease", () => {
	it("allows only one presenter and releases it for another view", () => {
		const lease = new VideoPlayerPresenterLease();
		const listener = vi.fn();
		lease.subscribe(listener);
		const first = Symbol("first");
		const second = Symbol("second");

		expect(lease.acquire(first)).toBe(true);
		expect(lease.acquire(second)).toBe(false);
		expect(lease.getSnapshot()).toBe(first);

		lease.release(first);
		expect(lease.acquire(second)).toBe(true);
		expect(lease.getSnapshot()).toBe(second);
		expect(listener).toHaveBeenCalledTimes(3);
	});
});
