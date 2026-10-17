import { describe, expect, it, vi } from "vite-plus/test";
import { TransportError } from "../types";
import {
	classifyYoudaoErrorCode,
	requestYoudaoJson,
	resolveYoudaoConnection,
	YoudaoTransportError,
} from "../youdaoTransport";

const connection = {
	endpoint: "https://openapi.youdao.com/api",
	appKey: "key",
	appSecret: "secret",
};

function response(payload: unknown, status = 200) {
	return { status, text: JSON.stringify(payload) };
}

describe("Youdao transport", () => {
	it("validates and trims the resolved connection", () => {
		expect(
			resolveYoudaoConnection({
				endpoint: " https://openapi.youdao.com/api ",
				appKey: " k ",
				appSecret: " s ",
			}),
		).toEqual({ endpoint: "https://openapi.youdao.com/api", appKey: "k", appSecret: "s" });

		expect(() =>
			resolveYoudaoConnection({ endpoint: "not a url", appKey: "k", appSecret: "s" }),
		).toThrow(expect.objectContaining({ kind: "invalid-config" }));
		expect(() =>
			resolveYoudaoConnection({ endpoint: "https://a.example", appKey: " ", appSecret: "s" }),
		).toThrow(expect.objectContaining({ kind: "missing-key" }));
	});

	it("signs the documented v3 form and returns the parsed payload", async () => {
		const request = vi
			.fn()
			.mockResolvedValue(response({ errorCode: "0", translation: ["hi"] }));
		const payload = await requestYoudaoJson({
			connection,
			query: "你好",
			fields: { from: "zh-CHS", to: "en" },
			net: { request },
			label: "test-youdao",
		});

		expect(payload).toEqual({ errorCode: "0", translation: ["hi"] });
		const sent = request.mock.calls[0]![0];
		const form = new URLSearchParams(sent.body);
		expect(sent).toMatchObject({
			label: "test-youdao",
			method: "POST",
			url: connection.endpoint,
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
		});
		expect(form.get("from")).toBe("zh-CHS");
		expect(form.get("signType")).toBe("v3");
	});

	it.each([
		["108", "unauthorized"],
		["411", "rate-limited"],
		["120", "not-found"],
		["500", "server"],
	])("classifies Youdao code %s as %s", async (code, kind) => {
		await expect(
			requestYoudaoJson({
				connection,
				query: "hello",
				fields: {},
				net: { request: async () => response({ errorCode: code }) },
				label: "test",
			}),
		).rejects.toMatchObject({ kind, rawCode: code });
	});

	it("classifies the shared error-code table", () => {
		expect(classifyYoudaoErrorCode("111")).toBe("unauthorized");
		expect(classifyYoudaoErrorCode("412")).toBe("rate-limited");
		expect(classifyYoudaoErrorCode("120")).toBe("not-found");
		expect(classifyYoudaoErrorCode("999")).toBe("server");
	});

	it("rejects malformed JSON and non-object payloads", async () => {
		await expect(
			requestYoudaoJson({
				connection,
				query: "hello",
				fields: {},
				net: { request: async () => ({ status: 200, text: "{" }) },
				label: "test",
			}),
		).rejects.toMatchObject({ kind: "invalid-response" });
		await expect(
			requestYoudaoJson({
				connection,
				query: "hello",
				fields: {},
				net: { request: async () => response([1]) },
				label: "test",
			}),
		).rejects.toMatchObject({ kind: "invalid-response" });
	});

	it("passes outbound transport errors through unchanged", async () => {
		const pending = requestYoudaoJson({
			connection,
			query: "hello",
			fields: {},
			net: {
				request: async () => {
					throw new TransportError("timeout");
				},
			},
			label: "test",
		});
		await expect(pending).rejects.toBeInstanceOf(TransportError);
		await expect(pending).rejects.toMatchObject({ code: "timeout" });
	});

	it("exposes the transport error class for feature mapping", () => {
		expect(new YoudaoTransportError("server", "500")).toBeInstanceOf(Error);
	});
});
