import React from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_SETTINGS } from "../../../core/host/settingsSlices";
import { createFakeWorkbenchHost } from "../../../core/host/__tests__/fakeWorkbenchHost";
import { createVideoPlayerFeature } from "../feature";
import type { PlayerViewMount } from "../ui/playerViewInteraction";
import type { ShadowingViewBridge } from "../ui/VideoPlayerView";

const captured = vi.hoisted(() => ({ definition: null as unknown, clearDrafts: vi.fn() }));
vi.mock("obsidian", () => ({ Notice: vi.fn(), Platform: { resourcePathPrefix: "app://vault/" } }));
vi.mock("../../../core/host/reactItemView", () => ({
	createReactItemView: (definition: unknown) => {
		captured.definition = definition;
		return vi.fn();
	},
}));
vi.mock("../ui/playerViewInteraction", () => ({
	PlayerViewInteraction: class {
		mount() {
			return {
				getSnapshot: () => ({ role: "presenter" }),
				subscribe: () => () => undefined,
				dispose: vi.fn(),
			};
		}
		dispose() {}
	},
}));
vi.mock("../obsidian/videoShadowingDesktopAdapter", () => ({
	VideoShadowingDesktopAdapter: class {
		readonly jobs = {
			getCueEditTarget: vi.fn(),
			saveCueEdit: vi.fn(),
			reloadSource: vi.fn(),
		};
		readonly shadowingSession = {
			getSnapshot: () => ({ enabled: false, cues: [] }),
			subscribe: () => () => undefined,
			act: vi.fn(),
			stopForPresenterLoss: vi.fn(),
			clearSubtitleDrafts: captured.clearDrafts,
		};
		bindPresenterWindow() {}
		dispose() {}
	},
}));

interface Resource {
	readonly view: PlayerViewMount & { dispose: ReturnType<typeof vi.fn> };
}
interface Acquired {
	readonly resource: Resource;
	dispose(): void;
}
interface Definition {
	acquire(context: { rootEl: HTMLElement }): Acquired;
	render(context: {
		language: "zh" | "en";
		rootEl: HTMLElement;
		resource: Resource;
	}): React.ReactElement<{
		children: React.ReactElement<{ shadowing: ShadowingViewBridge }>;
	}>;
}

describe("player view lifetime", () => {
	it("mounts a view interaction for each acquired leaf and disposes it independently", () => {
		const app = {
			workspace: { getLeavesOfType: () => [] },
			loadLocalStorage: () => null,
			saveLocalStorage: vi.fn(),
		};
		const fake = createFakeWorkbenchHost("videoPlayer", DEFAULT_SETTINGS, app);
		const feature = createVideoPlayerFeature();
		feature.render(fake.host);
		const definition = captured.definition as Definition;
		const rootEl = { ownerDocument: { defaultView: null } } as unknown as HTMLElement;
		const first = definition.acquire({ rootEl });
		const second = definition.acquire({ rootEl });
		expect(first.resource.view).not.toBe(second.resource.view);
		for (const language of ["zh", "en"] as const) {
			const rendered = definition.render({ rootEl, language, resource: first.resource });
			expect(rendered.props.children.props.shadowing).toBeDefined();
		}
		first.dispose();
		expect(first.resource.view.dispose).toHaveBeenCalledOnce();
		expect(second.resource.view.dispose).not.toHaveBeenCalled();
		expect(captured.clearDrafts).not.toHaveBeenCalled();
		second.dispose();
		expect(captured.clearDrafts).toHaveBeenCalledOnce();
		feature.stop();
	});
});
