import { describe, expect, it, vi } from "vite-plus/test";
import { TransportError } from "../../../../core/net/types";
import { translateYoudao, youdaoV3SignInput } from "../youdao";

const connection = {
	baseUrl: "https://openapi.youdao.com/api",
	appKeySecretId: "app-key",
	appSecretSecretId: "app-secret",
};

describe("translateYoudao", () => {
	it("signs and sends the documented v3 form request", async () => {
		const request = vi.fn().mockResolvedValue({
			status: 200,
			text: JSON.stringify({ errorCode: "0", translation: ["hello"] }),
		});
		await expect(
			translateYoudao(connection, "你好", "zh-en", {
				request,
				readSecret: (id) => (id === "app-key" ? "key" : "secret"),
			}),
		).resolves.toEqual({ text: "hello", usage: null });
		const form = new URLSearchParams(request.mock.calls[0]![0].body);
		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({
				url: connection.baseUrl,
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
			}),
		);
		expect(form.get("from")).toBe("zh-CHS");
		expect(form.get("to")).toBe("en");
		expect(form.get("signType")).toBe("v3");
	});

	it("uses code points in the v3 signing input and safely maps failures", async () => {
		expect(youdaoV3SignInput("😀".repeat(21))).toBe(`${"😀".repeat(10)}21${"😀".repeat(10)}`);
		await expect(
			translateYoudao(connection, "hello", "en-zh", {
				request: async () => ({ status: 200, text: JSON.stringify({ errorCode: "411" }) }),
				readSecret: () => "secret",
			}),
		).rejects.toMatchObject({ code: "rate-limited" });
	});

	it("preserves the outbound port timeout classification", async () => {
		const pending = translateYoudao(connection, "hello", "en-zh", {
			request: async () => {
				throw new TransportError("timeout");
			},
			readSecret: () => "secret",
		});
		await expect(pending).rejects.toMatchObject({ code: "timeout" });
	});
});
