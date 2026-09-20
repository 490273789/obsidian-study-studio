import { describe, expect, it, vi } from "vitest";
import {
	LocalVideoPlayerStateAuthority,
	type VideoPlayerDocumentStore,
} from "../localVideoPlayerState";
import type { DeviceVideoPlayerStateV1 } from "../types";
import { emptyState } from "../videoPlayerRuntime";

class MemoryDocumentStore implements VideoPlayerDocumentStore {
	state: DeviceVideoPlayerStateV1 = emptyState();
	load = () => this.state;
	save = (state: DeviceVideoPlayerStateV1) => {
		this.state = state;
	};
	clear = () => {
		this.state = emptyState();
	};
}

describe("LocalVideoPlayerStateAuthority", () => {
	it("merges interleaved Playback session and Player view updates into one document", () => {
		const document = new MemoryDocumentStore();
		const authority = new LocalVideoPlayerStateAuthority(document);
		const source = { id: "one", path: "/one.mp4", name: "one.mp4" };

		authority.playback.save({
			...authority.playback.load(),
			sources: [source],
			currentSourceId: source.id,
		});
		authority.presentation.save({
			floatingRect: { x: 12, y: 24, width: 480, height: 320 },
			queueExpanded: false,
		});
		authority.playback.save({
			...authority.playback.load(),
			playbackRate: 1.5,
		});

		expect(document.state).toMatchObject({
			sources: [source],
			currentSourceId: source.id,
			playbackRate: 1.5,
			floatingRect: { x: 12, y: 24, width: 480, height: 320 },
			queueExpanded: false,
		});
	});

	it("keeps failed presentation writes in memory, reports them, and retries the latest document", () => {
		const document = new MemoryDocumentStore();
		const failure = new Error("disk full");
		const save = vi
			.spyOn(document, "save")
			.mockImplementationOnce(() => {
				throw failure;
			})
			.mockImplementation((state) => {
				document.state = state;
			});
		const report = vi.fn();
		const authority = new LocalVideoPlayerStateAuthority(document, { report });

		authority.presentation.save({ floatingRect: null, queueExpanded: false });

		expect(authority.presentation.load().queueExpanded).toBe(false);
		expect(report).toHaveBeenCalledWith({
			kind: "presentation-save-failed",
			error: failure,
		});

		authority.presentation.save({
			floatingRect: { x: 20, y: 30, width: 400, height: 300 },
			queueExpanded: false,
		});

		expect(save).toHaveBeenCalledTimes(2);
		expect(document.state).toMatchObject({
			floatingRect: { x: 20, y: 30, width: 400, height: 300 },
			queueExpanded: false,
		});
	});
});
