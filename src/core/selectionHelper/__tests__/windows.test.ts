import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_SETTINGS } from "../../host/settingsSlices";
import { createFakeWorkbenchHost } from "../../host/__tests__/fakeWorkbenchHost";
import { createSelectionHelperModule } from "../module";

const instances = vi.hoisted(() => ({ listeners: [] as any[], webs: [] as any[] }));
vi.mock("obsidian", () => ({ Platform: { isDesktopApp: true } }));
vi.mock("../obsidian/selectionListener", () => ({
	SelectionListener: class {
		start = vi.fn();
		stop = vi.fn();
		refresh = vi.fn();
		constructor(public deps: any) {
			instances.listeners.push(this);
		}
	},
}));
vi.mock("../obsidian/webviewSelection", () => ({
	WebviewSelectionAdapter: class {
		start = vi.fn();
		stop = vi.fn();
		constructor(public deps: any) {
			instances.webs.push(this);
		}
	},
}));

afterEach(() => {
	vi.unstubAllGlobals();
	instances.listeners.length = 0;
	instances.webs.length = 0;
});

describe("selection windows", () => {
	it("attaches each existing document once, follows new windows, and releases all resources", () => {
		const main = {},
			popout = {},
			later = {};
		vi.stubGlobal("document", main);
		const events = new Map<string, (...args: any[]) => void>();
		const workspace = {
			iterateAllLeaves: (visit: (leaf: unknown) => void) => {
				for (const doc of [main, popout, popout])
					visit({ view: { containerEl: { ownerDocument: doc } } });
			},
			on: vi.fn((name, handler) => {
				events.set(name, handler);
				return name;
			}),
			offref: vi.fn(),
		};
		const fake = createFakeWorkbenchHost("selectionHelper", DEFAULT_SETTINGS, {
			workspace,
			isDarkMode: () => false,
		});
		const module = createSelectionHelperModule({
			dictionary: {
				sources: () => [],
				startLookup: () => null,
				openInMainTab: async () => {},
			},
			translation: { available: () => true, openPrefilled: async () => {} },
		});
		module.render(fake.host);
		expect(instances.listeners.map((i) => i.deps.document)).toEqual([main, popout]);
		events.get("window-open")?.({}, { document: later });
		events.get("window-open")?.({}, { document: later });
		expect(instances.listeners).toHaveLength(3);
		const helper = instances.listeners[2].deps.helper;
		const lease = instances.webs[2].deps.openSource();
		expect(helper.ownsSource(instances.listeners[2].deps.owner, lease.reference)).toBe(true);
		expect(helper.ownsSource(instances.listeners[1].deps.owner, lease.reference)).toBe(false);
		const candidate = {
			text: "hello",
			x: 0,
			y: 0,
			eligibleContext: true,
			altKey: true,
			shiftKey: true,
			ctrlOrMetaKey: true,
		};
		lease.capture().submit(candidate);
		const pending = lease.capture();
		instances.webs[2].deps.interrupt();
		expect(pending.submit(candidate)).toBe(false);
		expect(helper.getSnapshot().visible).toBe(true);
		instances.webs[2].deps.onStatus("unavailable");
		const compatibility = fake.sections.get("selectionPopup")?.presentation("zh").snapshot;
		expect(JSON.stringify(compatibility)).toContain("部分网页无法接入");
		lease.dismiss();
		expect(helper.getSnapshot().visible).toBe(false);
		events.get("css-change")?.();
		expect(instances.listeners[1].refresh).toHaveBeenCalledTimes(2);
		events.get("window-close")?.({}, { document: popout });
		expect(instances.listeners[1].stop).toHaveBeenCalledOnce();
		expect(instances.webs[1].stop).toHaveBeenCalledOnce();
		events.get("window-open")?.({}, { document: popout });
		expect(instances.listeners).toHaveLength(4);
		expect(instances.listeners[3].deps.owner).not.toBe(instances.listeners[1].deps.owner);
		const reopened = instances.webs[3].deps.openSource();
		expect(helper.ownsSource(instances.listeners[3].deps.owner, reopened.reference)).toBe(true);
		module.stop();
		for (const item of [...instances.listeners, ...instances.webs])
			expect(item.stop).toHaveBeenCalledOnce();
		expect(workspace.offref).toHaveBeenCalledTimes(3);
	});
});
