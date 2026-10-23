import { describe, expect, it } from "vite-plus/test";
import { identifyShadowSources, relinkShadowSource } from "../shadowSourceIdentity";

const source = (id: string, path: string) => ({ id, path, name: path.split("/").pop()! });

describe("shadow source identity", () => {
	it("reuses a removed video's source ID when its canonical path is selected again", () => {
		const registry = { "/videos/one.mp4": "original" };
		expect(
			identifyShadowSources(registry, [source("new-random", "/videos/one.mp4")], []),
		).toEqual([source("original", "/videos/one.mp4")]);
	});

	it("keeps the source ID after explicit relink and retires the old path", () => {
		const registry = { "/videos/old.mp4": "original" };
		expect(
			relinkShadowSource(registry, "original", source("new-random", "/videos/new.mp4")),
		).toEqual(source("original", "/videos/new.mp4"));
		expect(registry).toEqual({ "/videos/new.mp4": "original" });
		const addedOld = identifyShadowSources(
			registry,
			[source("another", "/videos/old.mp4")],
			[source("original", "/videos/new.mp4")],
		);
		expect(addedOld[0]?.id).toBe("another");
	});

	it("does not reuse a stale ID already occupied by another path", () => {
		const registry = { "/videos/old.mp4": "original" };
		const added = identifyShadowSources(
			registry,
			[source("fresh", "/videos/old.mp4")],
			[source("original", "/videos/new.mp4")],
		);
		expect(added[0]?.id).toBe("fresh");
	});
});
