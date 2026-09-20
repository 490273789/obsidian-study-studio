import { describe, expect, it, vi } from "vitest";
import { BrowserPlayerViewDomAdapter } from "../playerViewDomAdapter";

interface FakeNode {
	parentElement: FakeNode | null;
	append(child: FakeNode): void;
	remove(): void;
	addEventListener: ReturnType<typeof vi.fn>;
	removeEventListener: ReturnType<typeof vi.fn>;
	focus: ReturnType<typeof vi.fn>;
}

function node(): FakeNode {
	const value: FakeNode = {
		parentElement: null,
		append(child) {
			child.parentElement = value;
		},
		remove() {
			value.parentElement = null;
		},
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		focus: vi.fn(),
	};
	return value;
}

describe("BrowserPlayerViewDomAdapter", () => {
	it("creates one owner-document media element and reparents it across player surfaces", () => {
		const media = Object.assign(node(), {
			className: "",
			playsInline: false,
			preload: "",
			tabIndex: 0,
			pause: vi.fn(),
			currentTime: 0,
			duration: 0,
			paused: true,
			playbackRate: 1,
			src: "",
			play: vi.fn(async () => undefined),
			load: vi.fn(),
		});
		const win = {
			innerWidth: 1000,
			innerHeight: 800,
			requestAnimationFrame: (callback: FrameRequestCallback) => {
				callback(0);
				return 1;
			},
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		};
		const createElement = vi.fn(() => media);
		const ownerDocument = {
			createElement,
			defaultView: win,
		} as unknown as Document;
		const mount = new BrowserPlayerViewDomAdapter().mount({
			ownerDocument,
			getSnapshot: () => ({
				role: "presenter",
				presentation: { kind: "docked" },
				queueExpanded: true,
			}),
			act: () => ({ kind: "applied" }),
			focusReady: vi.fn(),
			beginPointer: vi.fn(),
			movePointer: vi.fn(),
			finishPointer: vi.fn(),
			viewportChanged: vi.fn(),
		});
		const docked = node();
		const floating = node();

		mount.setActive(true);
		mount.refs.mediaHost(docked as unknown as HTMLElement);
		expect(media.parentElement).toBe(docked);

		mount.refs.mediaHost(floating as unknown as HTMLElement);
		expect(media.parentElement).toBe(floating);
		expect(createElement).toHaveBeenCalledOnce();

		mount.dispose();
		expect(media.pause).toHaveBeenCalledOnce();
		expect(media.parentElement).toBeNull();
	});
});
