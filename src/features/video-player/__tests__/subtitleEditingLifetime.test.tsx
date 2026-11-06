import React from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_SETTINGS } from "../../../core/host/settingsSlices";
import { createFakeWorkbenchHost } from "../../../core/host/__tests__/fakeWorkbenchHost";
import { createVideoPlayerFeature } from "../feature";
import type { SubtitleEditingSession } from "../ui/subtitleEditingSession";

const captured = vi.hoisted(() => ({ definition: null as unknown }));
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
		};
		bindPresenterWindow() {}
		dispose() {}
	},
}));

interface Resource {
	readonly editing: SubtitleEditingSession;
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
		children: React.ReactElement<{ editing: SubtitleEditingSession }>;
	}>;
}

describe("subtitle editing view lifetime", () => {
	it("keeps an editor for the acquired view across renders and disposes each view independently", () => {
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
		expect(first.resource.editing).not.toBe(second.resource.editing);
		const firstDispose = vi.spyOn(first.resource.editing, "dispose");
		const secondDispose = vi.spyOn(second.resource.editing, "dispose");
		for (const language of ["zh", "en"] as const) {
			const rendered = definition.render({ rootEl, language, resource: first.resource });
			expect(rendered.props.children.props.editing).toBe(first.resource.editing);
		}
		first.dispose();
		expect(firstDispose).toHaveBeenCalledOnce();
		expect(secondDispose).not.toHaveBeenCalled();
		second.dispose();
		feature.stop();
	});
});
