import { describe, expect, it, vi } from "vite-plus/test";
import { TransportError } from "../../../../core/net/types";
import { EUDIC_IMAGE_RESOURCE_KIND, EudicImageResourceLoader } from "../eudic-image";

function createLoader(requestHostPinned = vi.fn()) {
	return { loader: new EudicImageResourceLoader({ requestHostPinned }), requestHostPinned };
}

describe("EudicImageResourceLoader", () => {
	it("ignores paths outside the pinned Eudic resource namespace", async () => {
		const { loader, requestHostPinned } = createLoader();

		await expect(loader.resolve("https://attacker.test/a.jpg")).resolves.toBeNull();
		expect(requestHostPinned).not.toHaveBeenCalled();
	});

	it("delegates transport constraints to the host-pinned outbound interface", async () => {
		const requestHostPinned = vi
			.fn()
			.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]).buffer, status: 200 });
		const { loader } = createLoader(requestHostPinned);

		await expect(loader.resolve(`${EUDIC_IMAGE_RESOURCE_KIND}/hello.jpg`)).resolves.toBe(
			"data:image/jpeg;base64,AQID",
		);
		expect(requestHostPinned).toHaveBeenCalledWith(
			expect.objectContaining({
				accept: "image/jpeg",
				label: "eudic-dictionary-image",
				maxBytes: 4_194_304,
				timeoutMs: 12_000,
				url: "https://fs-gateway.frdic.com/buckets/main/store_main/word_card/v2/en/hello.jpg",
			}),
		);
	});

	it.each([
		["rate-limited", "rate-limit"],
		["invalid-response", "invalid-response"],
		["timeout", "network"],
		["unauthorized", "server"],
	] as const)(
		"maps %s transport failures to %s dictionary failures",
		async (transport, domain) => {
			const requestHostPinned = vi
				.fn()
				.mockRejectedValue(new TransportError(transport, { httpStatus: 429 }));
			const { loader } = createLoader(requestHostPinned);

			await expect(
				loader.resolve(`${EUDIC_IMAGE_RESOURCE_KIND}/hello.jpg`),
			).rejects.toMatchObject({ code: domain, status: 429 });
		},
	);

	it("aborts an in-flight request when closed", async () => {
		const requestHostPinned = vi.fn(
			(spec: { signal?: AbortSignal }) =>
				new Promise((_resolve, reject) => {
					spec.signal?.addEventListener(
						"abort",
						() => reject(new TransportError("cancelled")),
						{ once: true },
					);
				}),
		);
		const { loader } = createLoader(requestHostPinned);
		const pending = loader.resolve(`${EUDIC_IMAGE_RESOURCE_KIND}/hello.jpg`);

		loader.close();

		await expect(pending).rejects.toMatchObject({ code: "network" });
	});
});
