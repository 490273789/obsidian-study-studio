import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SandboxDocumentFrame, type SandboxDocumentFrameProps } from "./SandboxDocumentFrame";

const lifecycle = vi.hoisted(() => ({
	effects: [] as Array<() => void | (() => void)>,
	refs: [] as Array<{ current: unknown }>,
	hosts: [] as Array<{
		register: ReturnType<typeof vi.fn>;
		unregister: ReturnType<typeof vi.fn>;
		dispose: ReturnType<typeof vi.fn>;
		setTheme: ReturnType<typeof vi.fn>;
	}>,
}));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useEffect: (effect: () => void | (() => void)) => lifecycle.effects.push(effect),
	useRef: (value: unknown) => {
		const ref = { current: value };
		lifecycle.refs.push(ref);
		return ref;
	},
}));
vi.mock("../domain/sandbox-document", () => ({
	createDictionarySandboxHost: () => {
		const host = {
			register: vi.fn(),
			unregister: vi.fn(),
			dispose: vi.fn(),
			setTheme: vi.fn(),
		};
		lifecycle.hosts.push(host);
		return host;
	},
}));

afterEach(() => {
	lifecycle.effects.length = 0;
	lifecycle.refs.length = 0;
	lifecycle.hosts.length = 0;
	vi.restoreAllMocks();
});

function render() {
	const component = (
		SandboxDocumentFrame as unknown as {
			type: (props: SandboxDocumentFrameProps) => React.ReactElement;
		}
	).type;
	component({ document: {} as never, theme: "dark" });
	lifecycle.refs[0]!.current = {};
}

describe("sandbox frame lifetime", () => {
	it("releases a host when registration fails before effect cleanup can be installed", () => {
		render();
		// Register a failure on every newly-created host, without reaching into the frame's internals.
		const push = lifecycle.hosts.push.bind(lifecycle.hosts);
		vi.spyOn(lifecycle.hosts, "push").mockImplementation((host) => {
			host.register.mockImplementation(() => {
				throw new Error("Invalid document");
			});
			return push(host);
		});
		expect(() => {
			for (const effect of lifecycle.effects) effect();
		}).toThrow("Invalid document");
		expect(lifecycle.hosts[0]?.dispose).toHaveBeenCalledOnce();
	});

	it("releases its host on unmount and creates a live host on a replayed mount", () => {
		render();
		const cleanups = lifecycle.effects.map((effect) => effect());
		for (const cleanup of cleanups) cleanup?.();
		expect(lifecycle.hosts[0]?.unregister).toHaveBeenCalledOnce();
		expect(lifecycle.hosts[0]?.dispose).toHaveBeenCalledOnce();
		const replay = lifecycle.effects.map((effect) => effect());
		expect(lifecycle.hosts).toHaveLength(2);
		expect(lifecycle.hosts[1]?.register).toHaveBeenCalledOnce();
		expect(lifecycle.hosts[1]?.dispose).not.toHaveBeenCalled();
		for (const cleanup of replay) cleanup?.();
	});
});
