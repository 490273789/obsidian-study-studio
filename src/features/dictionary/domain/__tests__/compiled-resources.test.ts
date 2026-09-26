import { afterEach, describe, expect, it, vi } from "vitest";
import { CompiledDictionaryResources, type CompiledResource } from "../compiled-resources";
import { EudicImageResourceLoader, EUDIC_IMAGE_RESOURCE_KIND } from "../eudic-image";
import { TransportError } from "../../../../core/net/types";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
function resource(mime = "image/png", size = 3): CompiledResource {
	return { mime, data: new Uint8Array(size).buffer };
}
function setup(
	read = vi.fn<(path: string) => Promise<CompiledResource | null>>(),
	budgetBytes = 100,
) {
	const remote = { resolve: vi.fn<(path: string) => Promise<string | null>>(), close: vi.fn() };
	const canReadRemote = vi.fn(() => false);
	const resources = new CompiledDictionaryResources({ read, remote, canReadRemote, budgetBytes });
	return { resources, read, remote, canReadRemote };
}

afterEach(() => vi.restoreAllMocks());

describe("CompiledDictionaryResources", () => {
	it("shares one read and one URL across concurrent consumers and subsequent cache hits", async () => {
		const pending = deferred<CompiledResource | null>();
		const { resources, read } = setup(vi.fn(() => pending.promise));
		const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:shared");
		const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
		const a = resources.resolve("font.woff");
		const b = resources.resolve("font.woff");
		await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
		pending.resolve(resource("font/woff"));
		expect(await Promise.all([a, b])).toEqual(["blob:shared", "blob:shared"]);
		expect(await resources.resolve("font.woff")).toBe("blob:shared");
		expect(create).toHaveBeenCalledOnce();
		expect(read).toHaveBeenCalledOnce();
		resources.close();
		resources.close();
		expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:shared");
	});

	it("shares raw reads between text and ordinary resources without confusing MIME expectations", async () => {
		const pending = deferred<CompiledResource | null>();
		const { resources, read } = setup(vi.fn(() => pending.promise));
		const a = resources.resolveText("style", "text/css");
		const b = resources.resolveText("style", "text/javascript");
		const c = resources.resolve("style");
		await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
		pending.resolve({ mime: "text/css", data: new TextEncoder().encode("body{}").buffer });
		expect(await a).toBe("body{}");
		expect(await b).toBeNull();
		expect(await c).toMatch(/^data:text\/css/);
		expect(await resources.resolveText("style", "text/css")).toBe("body{}");
		expect(read).toHaveBeenCalledOnce();
		resources.close();
	});

	it("keeps independent paths independent and retries failures", async () => {
		const a = deferred<CompiledResource | null>();
		const { resources, read } = setup(
			vi.fn((path) => (path === "a" ? a.promise : Promise.resolve(resource()))),
		);
		const pending = resources.resolve("a");
		const rejected = expect(pending).rejects.toThrow("offline");
		expect(await resources.resolve("b")).toMatch(/^data:image\/png/);
		a.reject(new Error("offline"));
		await rejected;
		read.mockResolvedValue(resource());
		expect(await resources.resolve("a")).toMatch(/^data:image\/png/);
		expect(read).toHaveBeenCalledTimes(3);
		resources.close();
	});

	it("bounds local misses and never stores read errors as misses", async () => {
		const { resources, read } = setup(vi.fn(async () => null));
		expect(await resources.resolve("missing")).toBeNull();
		expect(await resources.resolve("missing")).toBeNull();
		expect(read).toHaveBeenCalledOnce();
		for (let i = 0; i < 256; i++) await resources.resolve(`missing-${i}`);
		await resources.resolve("missing");
		expect(read).toHaveBeenCalledTimes(258);
		resources.close();
	});

	it("does not let missing paths evict successfully cached fonts", async () => {
		const { resources, read } = setup(
			vi.fn(async (path) => (path === "font" ? resource("font/woff") : null)),
		);
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:retained");
		const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
		await resources.resolve("font");
		for (let i = 0; i < 300; i++) await resources.resolve(`missing-${i}`);
		expect(await resources.resolve("font")).toBe("blob:retained");
		expect(read.mock.calls.filter(([path]) => path === "font")).toHaveLength(1);
		expect(revoke).not.toHaveBeenCalled();
		resources.close();
	});

	it("coalesces remote requests only while pending, with retries after failure and success", async () => {
		const { resources, remote, canReadRemote } = setup(vi.fn(async () => null));
		canReadRemote.mockReturnValue(true);
		const pending = deferred<string | null>();
		remote.resolve.mockReturnValue(pending.promise);
		const a = resources.resolve("remote");
		const b = resources.resolve("remote");
		const settled = Promise.allSettled([a, b]);
		await vi.waitFor(() => expect(remote.resolve).toHaveBeenCalledOnce());
		pending.reject(new Error("timeout"));
		expect((await settled).map((result) => result.status)).toEqual(["rejected", "rejected"]);
		remote.resolve.mockResolvedValue("data:image/jpeg;base64,AQID");
		await resources.resolve("remote");
		await resources.resolve("remote");
		expect(remote.resolve).toHaveBeenCalledTimes(3);
		resources.close();
	});

	it("rejects pending consumers immediately and ignores late audio or text reads after close", async () => {
		const pending = deferred<CompiledResource | null>();
		const { resources, read, remote } = setup(vi.fn(() => pending.promise));
		const create = vi.spyOn(URL, "createObjectURL");
		const settled = Promise.allSettled([
			resources.resolve("font"),
			resources.resolveText("font", "text/css"),
		]);
		await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
		resources.close();
		expect((await settled).every((result) => result.status === "rejected")).toBe(true);
		pending.resolve(resource("font/woff"));
		await Promise.resolve();
		await Promise.resolve();
		expect(create).not.toHaveBeenCalled();
		await expect(resources.resolve("font")).rejects.toMatchObject({ code: "request" });
		expect(read).toHaveBeenCalledOnce();
		expect(remote.close).toHaveBeenCalledOnce();
	});

	it("aborts the actual remote loader on close and rejects all shared waiters", async () => {
		let signal: AbortSignal | undefined;
		const requestHostPinned = vi.fn(
			(spec: { signal?: AbortSignal }) =>
				new Promise<never>((_, reject) => {
					signal = spec.signal;
					signal?.addEventListener(
						"abort",
						() => reject(new TransportError("cancelled")),
						{ once: true },
					);
				}),
		);
		const resources = new CompiledDictionaryResources({
			read: async () => null,
			canReadRemote: () => true,
			remote: new EudicImageResourceLoader({ requestHostPinned }),
			budgetBytes: 100,
		});
		const path = `${EUDIC_IMAGE_RESOURCE_KIND}/hello.jpg`;
		const settled = Promise.allSettled([resources.resolve(path), resources.resolve(path)]);
		await vi.waitFor(() => expect(requestHostPinned).toHaveBeenCalledOnce());
		resources.close();
		expect(signal?.aborted).toBe(true);
		expect((await settled).every((result) => result.status === "rejected")).toBe(true);
	});

	it("discards late remote success even when the transport ignores cancellation", async () => {
		const pending = deferred<string | null>();
		const { resources, remote, canReadRemote } = setup(vi.fn(async () => null));
		canReadRemote.mockReturnValue(true);
		remote.resolve.mockReturnValue(pending.promise);
		const settled = Promise.allSettled([resources.resolve("remote")]);
		await vi.waitFor(() => expect(remote.resolve).toHaveBeenCalledOnce());
		resources.close();
		pending.resolve("data:image/jpeg;base64,AQID");
		expect((await settled)[0]?.status).toBe("rejected");
		await expect(resources.resolve("remote")).rejects.toMatchObject({ code: "request" });
		expect(remote.resolve).toHaveBeenCalledOnce();
	});

	it("revokes evicted URLs and never returns an immediately revoked oversized font", async () => {
		const { resources, read } = setup(
			vi.fn(async () => resource("font/woff", 3)),
			5,
		);
		const create = vi
			.spyOn(URL, "createObjectURL")
			.mockReturnValueOnce("blob:a")
			.mockReturnValueOnce("blob:b");
		const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
		expect(await resources.resolve("a")).toBe("blob:a");
		expect(await resources.resolve("b")).toBe("blob:b");
		expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:a");
		read.mockResolvedValue(resource("font/woff", 6));
		expect(await resources.resolve("large")).toBeNull();
		expect(create).toHaveBeenCalledTimes(2);
		resources.close();
		expect(revoke).toHaveBeenCalledTimes(2);
		expect(revoke).toHaveBeenLastCalledWith("blob:b");
	});

	it("does not decode wrong MIME, invalid UTF-8 or oversized text", async () => {
		const { resources, read } = setup(vi.fn(async () => resource("image/png")));
		expect(await resources.resolveText("wrong", "text/css")).toBeNull();
		read.mockResolvedValue({ mime: "text/css", data: new Uint8Array([255]).buffer });
		expect(await resources.resolveText("invalid", "text/css")).toBeNull();
		read.mockResolvedValue(resource("text/css", 8 * 1048576 + 1));
		expect(await resources.resolveText("large", "text/css")).toBeNull();
		resources.close();
	});
});
