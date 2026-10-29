import { describe, expect, it } from "vite-plus/test";
import { identifyVideoSources, relinkVideoSource } from "../videoSourceIdentity";

const source = (id: string, path: string) => ({ id, path, name: path.split("/").pop()! });

describe("video source identity", () => {
	it("reuses a removed video's source ID when its canonical path is selected again", () => {
		const registry = { "/videos/one.mp4": "original" };
		expect(
			identifyVideoSources(registry, [{ path: "/videos/one.mp4", name: "one.mp4" }], []),
		).toEqual([source("original", "/videos/one.mp4")]);
	});

	it("keeps the source ID after explicit relink and retires the old path", () => {
		const registry = { "/videos/old.mp4": "original" };
		expect(
			relinkVideoSource(registry, "original", { path: "/videos/new.mp4", name: "new.mp4" }),
		).toEqual(source("original", "/videos/new.mp4"));
		expect(registry).toEqual({ "/videos/new.mp4": "original" });
		const addedOld = identifyVideoSources(
			registry,
			[{ id: "another", path: "/videos/old.mp4", name: "old.mp4" }],
			[source("original", "/videos/new.mp4")],
		);
		expect(addedOld[0]?.id).toBe("another");
	});

	it("does not reuse a stale ID already occupied by another path", () => {
		const registry = { "/videos/old.mp4": "original" };
		const added = identifyVideoSources(
			registry,
			[{ id: "fresh", path: "/videos/old.mp4", name: "old.mp4" }],
			[source("original", "/videos/new.mp4")],
		);
		expect(added[0]?.id).toBe("fresh");
	});

	it("generates random ID if no ID provided and no registry entry exists", () => {
		const registry: Record<string, string> = {};
		const result = identifyVideoSources(
			registry,
			[{ path: "/videos/brand-new.mp4", name: "brand-new.mp4" }],
			[],
			() => "mock-generated-id",
		);
		expect(result).toEqual([source("mock-generated-id", "/videos/brand-new.mp4")]);
		expect(registry["/videos/brand-new.mp4"]).toBe("mock-generated-id");
	});
});
