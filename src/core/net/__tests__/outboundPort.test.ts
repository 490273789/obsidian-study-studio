import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { requestUrl } from "obsidian";
import { createOutboundPort, DEFAULT_REQUEST_TIMEOUT_MS } from "../outboundPort";
import { TransportError } from "../types";

vi.mock("obsidian", () => ({
	requestUrl: vi.fn(),
}));

const requestUrlMock = vi.mocked(requestUrl);

function createPort(options: { defaultTimeoutMs?: number } = {}) {
	const app = {
		secretStorage: { getSecret: vi.fn((id: string) => `secret:${id}`) },
	};
	return { app, port: createOutboundPort({ app: app as never, ...options }) };
}

function reply(status: number, text = "body") {
	requestUrlMock.mockResolvedValueOnce({ status, text } as never);
}

describe("outbound port", () => {
	afterEach(() => {
		requestUrlMock.mockReset();
		vi.useRealTimers();
	});

	it("returns the response for a success status", async () => {
		reply(200, '{"ok":true}');
		const { port } = createPort();

		await expect(port.request({ label: "test", url: "https://example.test" })).resolves.toEqual(
			{ status: 200, text: '{"ok":true}' },
		);
		expect(requestUrlMock).toHaveBeenCalledWith(
			expect.objectContaining({ url: "https://example.test", throw: false }),
		);
	});

	it("passes a binary body through to requestUrl unchanged", async () => {
		reply(200);
		const { port } = createPort();
		const body = new Uint8Array([0x80, 0xff, 0x00]).buffer;

		await port.request({
			label: "multipart",
			url: "https://example.test",
			method: "POST",
			body,
		});
		expect(requestUrlMock).toHaveBeenCalledWith(
			expect.objectContaining({ body, method: "POST" }),
		);
	});

	it.each([
		[401, "unauthorized"],
		[403, "unauthorized"],
		[404, "not-found"],
		[429, "rate-limited"],
		[500, "server"],
		[503, "server"],
	])("classifies status %i as %s", async (status, code) => {
		reply(status, "provider said no");
		const { port } = createPort();

		const error = await port
			.request({ label: "test", url: "https://example.test" })
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(TransportError);
		expect(error).toMatchObject({ code, httpStatus: status, responseText: "provider said no" });
	});

	it("classifies a rejected request as a network failure", async () => {
		requestUrlMock.mockRejectedValueOnce(new Error("offline"));
		const { port } = createPort();

		await expect(
			port.request({ label: "test", url: "https://example.test" }),
		).rejects.toMatchObject({ code: "network" });
	});

	it("rejects a response larger than the caller's accepted size", async () => {
		requestUrlMock.mockResolvedValueOnce({
			arrayBuffer: new ArrayBuffer(32),
			status: 200,
			text: "oversized",
		} as never);
		const { port } = createPort();

		await expect(
			port.request({ label: "test", maxBytes: 16, url: "https://example.test" }),
		).rejects.toMatchObject({ code: "invalid-response", httpStatus: 200 });
	});

	it("fails with timeout once the default deadline passes", async () => {
		vi.useFakeTimers();
		requestUrlMock.mockImplementation(() => new Promise(() => {}) as never);
		const { port } = createPort();

		const pending = port.request({ label: "test", url: "https://example.test" });
		const assertion = expect(pending).rejects.toMatchObject({ code: "timeout" });
		await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS);
		await assertion;
	});

	it("fails with cancelled when the caller aborts, without waiting for the deadline", async () => {
		requestUrlMock.mockImplementation(() => new Promise(() => {}) as never);
		const controller = new AbortController();
		const { port } = createPort();

		const pending = port.request({
			label: "test",
			url: "https://example.test",
			signal: controller.signal,
		});
		controller.abort();

		await expect(pending).rejects.toMatchObject({ code: "cancelled" });
	});

	it("rejects immediately when the signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const { port } = createPort();

		await expect(
			port.request({ label: "test", url: "https://example.test", signal: controller.signal }),
		).rejects.toMatchObject({ code: "cancelled" });
		expect(requestUrlMock).not.toHaveBeenCalled();
	});

	it("lets a caller disable the port deadline", async () => {
		vi.useFakeTimers();
		reply(200);
		const { port } = createPort({ defaultTimeoutMs: 0 });

		await expect(
			port.request({ label: "test", url: "https://example.test" }),
		).resolves.toMatchObject({ status: 200 });
	});

	it("reads credentials through the host secret storage", () => {
		const { app, port } = createPort();

		expect(port.readSecret("openai-key")).toBe("secret:openai-key");
		expect(app.secretStorage.getSecret).toHaveBeenCalledWith("openai-key");
	});

	describe("host-pinned bytes", () => {
		function replyWith(response: {
			status?: number;
			contentType?: string;
			bytes?: ArrayBuffer;
		}) {
			const fetchMock = vi.fn().mockResolvedValue({
				status: response.status ?? 200,
				headers: { get: () => response.contentType ?? null },
				arrayBuffer: async () => response.bytes ?? new ArrayBuffer(0),
			});
			vi.stubGlobal("fetch", fetchMock);
			return fetchMock;
		}

		afterEach(() => vi.unstubAllGlobals());

		it("refuses redirects and sends no credentials", async () => {
			const fetchMock = replyWith({
				status: 200,
				contentType: "image/jpeg",
				bytes: new Uint8Array([1, 2, 3]).buffer,
			});
			const { port } = createPort();

			const result = await port.requestHostPinned({
				label: "eudic",
				url: "https://img.example.test/a.jpg",
				accept: "image/jpeg",
				maxBytes: 16,
			});

			expect(result.bytes.byteLength).toBe(3);
			expect(fetchMock).toHaveBeenCalledWith(
				"https://img.example.test/a.jpg",
				expect.objectContaining({ credentials: "omit", redirect: "error" }),
			);
		});

		it("rejects a response whose MIME type is not accepted", async () => {
			replyWith({ status: 200, contentType: "text/html" });
			const { port } = createPort();

			await expect(
				port.requestHostPinned({
					label: "eudic",
					url: "https://img.example.test/a.jpg",
					accept: "image/jpeg",
					maxBytes: 16,
				}),
			).rejects.toMatchObject({ code: "invalid-response" });
		});

		it("rejects a body larger than the accepted size", async () => {
			replyWith({ status: 200, contentType: "image/jpeg", bytes: new ArrayBuffer(32) });
			const { port } = createPort();

			await expect(
				port.requestHostPinned({
					label: "eudic",
					url: "https://img.example.test/a.jpg",
					accept: "image/jpeg",
					maxBytes: 16,
				}),
			).rejects.toMatchObject({ code: "invalid-response" });
		});

		it("stops a streamed response as soon as it exceeds the accepted size", async () => {
			const cancel = vi.fn().mockResolvedValue(undefined);
			const releaseLock = vi.fn();
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue({
					body: {
						getReader: () => ({
							cancel,
							read: vi
								.fn()
								.mockResolvedValueOnce({ done: false, value: new Uint8Array(12) })
								.mockResolvedValueOnce({ done: false, value: new Uint8Array(12) }),
							releaseLock,
						}),
					},
					headers: {
						get: (name: string) => (name === "content-type" ? "image/jpeg" : null),
					},
					status: 200,
				}),
			);
			const { port } = createPort();

			await expect(
				port.requestHostPinned({
					accept: "image/jpeg",
					label: "eudic",
					maxBytes: 16,
					url: "https://img.example.test/a.jpg",
				}),
			).rejects.toMatchObject({ code: "invalid-response" });
			expect(cancel).toHaveBeenCalledOnce();
			expect(releaseLock).toHaveBeenCalledOnce();
		});
	});
});
