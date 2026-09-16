import { describe, expect, it } from "vitest";

describe("mediaHost attachment behavior", () => {
	it("attaches media element to host container when host mounts", () => {
		const media = {
			parentElement: null as unknown,
		};
		const host = {
			append: (child: unknown) => {
				media.parentElement = host;
			},
		};

		const attachMediaHost = (node: typeof host | null) => {
			if (node && media.parentElement !== node) {
				node.append(media);
			}
		};

		// Initial null check (e.g. empty state or unmount)
		attachMediaHost(null);
		expect(media.parentElement).toBeNull();

		// Host element mounts
		attachMediaHost(host);
		expect(media.parentElement).toBe(host);
	});

	it("moves media element when host switches (docked to floating or vice versa)", () => {
		const media = {
			parentElement: null as unknown,
		};
		const dockedHost = {
			append: (child: unknown) => {
				media.parentElement = dockedHost;
			},
		};
		const floatingHost = {
			append: (child: unknown) => {
				media.parentElement = floatingHost;
			},
		};

		const attachMediaHost = (node: typeof dockedHost | null) => {
			if (node && media.parentElement !== node) {
				node.append(media);
			}
		};

		attachMediaHost(dockedHost);
		expect(media.parentElement).toBe(dockedHost);

		// Switch to floating
		attachMediaHost(floatingHost);
		expect(media.parentElement).toBe(floatingHost);
	});
});
