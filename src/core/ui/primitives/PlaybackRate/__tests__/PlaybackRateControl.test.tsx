import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { PlaybackRateControl } from "../PlaybackRateControl";
import { PlaybackRatePopover } from "../PlaybackRatePopover";

const RATES = [0.5, 0.75, 1, 1.25, 1.5] as const;
const ignoreRef = () => undefined;

describe("playback rate control", () => {
	it("renders a labelled trigger that reports the current rate and menu state", () => {
		const markup = renderToStaticMarkup(
			<PlaybackRateControl
				label="播放速度"
				value={1.5}
				rates={RATES}
				onChange={vi.fn()}
				tone="dark"
			/>,
		);
		expect(markup).not.toContain("flashcard-speed-label");
		// The label is accessibility-only now: it names the control, not a visible caption.
		expect(markup).toContain('title="播放速度"');
		expect(markup).toContain("1.5×");
		expect(markup).toContain('aria-haspopup="menu"');
		expect(markup).toContain('aria-expanded="false"');
		expect(markup).toContain('aria-label="播放速度 1.5×"');
		expect(markup).toContain("is-dark");
		// The portaled rate grid only exists while the control is open.
		expect(markup).not.toContain("menuitemradio");
	});

	it("renders the menu with one radio item per rate and checks the current one", () => {
		const markup = renderToStaticMarkup(
			<PlaybackRatePopover
				id="speed-menu"
				label="播放速度"
				value={1.25}
				rates={RATES}
				tone="default"
				position={{ top: 120, left: 40, placement: "top" }}
				popoverRef={ignoreRef}
				optionRef={ignoreRef}
				onSelect={vi.fn()}
				onKeyDown={vi.fn()}
			/>,
		);
		expect(markup).toContain('role="menu"');
		expect(markup).toContain('aria-label="播放速度"');
		expect(markup).toContain("data-positioned");
		expect(markup).toContain("top:120px");
		expect(markup).toContain("left:40px");
		expect(markup.match(/role="menuitemradio"/g)).toHaveLength(RATES.length);
		expect(markup.match(/aria-checked="true"/g)).toHaveLength(1);
		expect(markup).toContain("is-active");
		expect(markup).toContain("--speed-columns:5");
	});

	it("stays unpositioned and undecorated until the control measures it", () => {
		const markup = renderToStaticMarkup(
			<PlaybackRatePopover
				id="speed-menu"
				label="播放速度"
				value={1}
				rates={RATES}
				tone="dark"
				position={null}
				popoverRef={ignoreRef}
				optionRef={ignoreRef}
				onSelect={vi.fn()}
				onKeyDown={vi.fn()}
			/>,
		);
		expect(markup).not.toContain("data-positioned");
		expect(markup).not.toContain('style="top:');
		expect(markup).toContain("is-dark");
	});
});
