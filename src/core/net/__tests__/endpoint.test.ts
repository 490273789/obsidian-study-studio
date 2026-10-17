import { describe, expect, it } from "vite-plus/test";
import { EndpointValidationError, validateHttpEndpoint } from "../endpoint";

describe("validateHttpEndpoint", () => {
	it("accepts plain http(s) endpoints and normalizes them", () => {
		expect(validateHttpEndpoint("https://openapi.youdao.com/api")).toBe(
			"https://openapi.youdao.com/api",
		);
		expect(validateHttpEndpoint(" http://localhost:8080/v1 ")).toBe("http://localhost:8080/v1");
	});

	it.each([
		["ftp://example.com", "non-http protocol"],
		["https://user:pass@example.com", "embedded credentials"],
		["https://example.com/?q=1", "query"],
		["https://example.com/#hash", "fragment"],
		["not a url", "invalid URL"],
		["https://example.com/{id}", "template characters"],
	])("rejects %s", (value) => {
		expect(() => validateHttpEndpoint(value)).toThrow(EndpointValidationError);
	});

	it("can allow braces for callers without the template rule", () => {
		expect(validateHttpEndpoint("https://example.com/a", { rejectBraces: false })).toBe(
			"https://example.com/a",
		);
	});
});
