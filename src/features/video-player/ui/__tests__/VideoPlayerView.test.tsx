import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../../core/ui/context/I18nContext";
import type { VideoPlayerSnapshot } from "../../domain/types";
import type { VideoPlayerRuntime } from "../../domain/videoPlayerRuntime";
import { normalizeVideoPlayerSettings } from "../../settings/slice";
import type { PlayerViewMount } from "../playerViewInteraction";
import { VideoPlayerView } from "../VideoPlayerView";

// Supply the same stable snapshots to the server renderer; production is client-only.
vi.mock("react", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react")>();
	return {
		...actual,
		useSyncExternalStore: <T,>(
			subscribe: (listener: () => void) => () => void,
			getSnapshot: () => T,
		) => actual.useSyncExternalStore(subscribe, getSnapshot, getSnapshot),
	};
});

describe("video queue controls", () => {
	it("renders each source as a native non-submit button with its name and progress", () => {
		const snapshot: VideoPlayerSnapshot = {
			sources: [{ id: "lesson", name: "Lesson.mp4", path: "/videos/Lesson.mp4" }],
			completedSourceIds: [],
			progressBySource: {},
			currentSourceId: "lesson",
			currentTime: 30,
			duration: 120,
			playbackRate: 1,
			playing: false,
			error: null,
		};
		const runtime = {
			getSnapshot: () => snapshot,
			subscribe: () => () => {},
		} as unknown as VideoPlayerRuntime;
		const view: PlayerViewMount = {
			getSnapshot: () => ({
				role: "presenter",
				presentation: { kind: "docked" },
				queueExpanded: true,
			}),
			subscribe: () => () => {},
			refs: {
				focusSurface: () => {},
				mediaHost: () => {},
				floatingHeader: () => {},
				resizeLeft: () => {},
				resizeRight: () => {},
			},
			act: () => ({ kind: "applied" }),
			dispose: () => {},
		};
		const html = renderToStaticMarkup(
			<I18nProvider language="en">
				<VideoPlayerView
					runtime={runtime}
					view={view}
					language="en"
					rootEl={{ ownerDocument: {} } as HTMLElement}
					settings={normalizeVideoPlayerSettings({})}
					onFocusExisting={() => {}}
					onOpenSettings={() => {}}
					onPickVideos={async () => []}
					onPickReplacement={async () => null}
				/>
			</I18nProvider>,
		);
		const sourceButton = html.match(
			/<button\b[^>]*title="Lesson\.mp4[^>]*>[\s\S]*?<\/button>/,
		)?.[0];
		expect(sourceButton).toBeDefined();
		expect(sourceButton).toContain('type="button"');
		expect(sourceButton).toContain("Lesson.mp4</span>");
		expect(sourceButton).toContain("0:30 / 2:00</span>");
		expect(sourceButton).not.toMatch(/<(?:div|button)\b.*<(?:div|button)\b/);
		expect(sourceButton).not.toContain('role="button"');
		expect(sourceButton).not.toContain("tabindex=");
	});
});
