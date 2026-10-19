import { describe, expect, it, vi } from "vite-plus/test";
import type { AudioMaterial, AudioPracticeSnapshot, SubtitleCue } from "../../domain/types";
import type { AudioPracticeSettings } from "../../settings/slice";
import { audioFailure } from "../../domain/failures";
import { MAX_AUDIO_BYTES } from "../limits";
import type { GenerationInput, GenerationSnapshot } from "../subtitleGeneration";
import type { AudioSourceStat } from "../types";
import { SubtitleWorkflow } from "../subtitleWorkflow";

const settings: AudioPracticeSettings = {
	enabled: true,
	provider: "bailian",
	bailianWorkspaceId: "workspace",
	bailianSecretId: "secret",
	bailianModel: "fun-asr-flash-2026-06-15",
	openaiBaseUrl: "https://api.openai.com/v1",
	openaiSecretId: "",
	openaiModel: "whisper-1",
};

const savedCues: SubtitleCue[] = [{ id: "cue-1", text: "hello", start: 0, end: 1 }];

function material(id = "a", patch: Partial<AudioMaterial> = {}): AudioMaterial {
	return {
		id,
		title: id,
		audioPath: `${id}.wav`,
		subtitlePath: null,
		originalText: "hello",
		...patch,
	};
}

function generationSnapshot(patch: Partial<GenerationSnapshot> = {}): GenerationSnapshot {
	return {
		status: "idle",
		cues: [],
		completedChunks: 0,
		totalChunks: 0,
		duration: 0,
		failure: null,
		notice: null,
		taskKey: null,
		...patch,
	};
}

function harness(
	options: {
		materials?: AudioMaterial[];
		currentMaterialId?: string | null;
		generation?: Partial<GenerationSnapshot>;
		sourceStats?: (AudioSourceStat | null)[];
		sourceStat?: AudioSourceStat | null;
		readBinary?: () => Promise<ArrayBuffer>;
		matchesSource?: () => Promise<boolean>;
		settingsPatch?: Partial<AudioPracticeSettings>;
		secret?: string | null;
	} = {},
) {
	const materials = options.materials ?? [material()];
	let runtimeSnapshot = {
		materials,
		currentMaterialId: options.currentMaterialId ?? materials[0]?.id ?? null,
		currentMaterial: null,
		cues: [],
		currentCueId: null,
		currentTime: 0,
		duration: null,
		playing: false,
		revealed: false,
		loading: false,
		failure: null,
		invalidatedMarks: 0,
	} as unknown as AudioPracticeSnapshot;
	const runtimeListeners = new Set<() => void>();

	let generationState = generationSnapshot(options.generation);
	const generationListeners = new Set<() => void>();
	const publishGeneration = (patch: Partial<GenerationSnapshot>) => {
		generationState = { ...generationState, ...patch };
		for (const listener of generationListeners) listener();
	};

	const remainingStats = [...(options.sourceStats ?? [])];
	const defaultStat: AudioSourceStat | null =
		options.sourceStat === undefined ? { size: 1024, mtime: 10 } : options.sourceStat;

	const runtime = {
		getSnapshot: () => runtimeSnapshot,
		subscribe: (listener: () => void) => {
			runtimeListeners.add(listener);
			return () => runtimeListeners.delete(listener);
		},
		saveSubtitles: vi.fn(async () => "a.practice.srt"),
	};
	const generation = {
		getSnapshot: () => generationState,
		subscribe: (listener: () => void) => {
			generationListeners.add(listener);
			return () => generationListeners.delete(listener);
		},
		generate: vi.fn(async () => {}),
		cancel: vi.fn(() => {
			publishGeneration({ status: "cancelled", failure: null });
		}),
		restore: vi.fn(async () => true),
		matchesSource: vi.fn(options.matchesSource ?? (async () => true)),
		validatedCues: vi.fn(() => savedCues.map((cue) => ({ ...cue }))),
	};
	const source = {
		stat: vi.fn(() => (remainingStats.length ? (remainingStats.shift() ?? null) : defaultStat)),
		readBinary: vi.fn(options.readBinary ?? (async () => new ArrayBuffer(8))),
	};
	const settingsPort = {
		read: () => ({ ...settings, ...options.settingsPatch }),
		readSecret: vi.fn(() => (options.secret === undefined ? "secret" : options.secret)),
	};
	const workflow = new SubtitleWorkflow({
		runtime,
		generation,
		settings: settingsPort,
		source,
	});
	return {
		workflow,
		runtime,
		generation,
		source,
		switchMaterial: (id: string) => {
			runtimeSnapshot = { ...runtimeSnapshot, currentMaterialId: id };
			for (const listener of runtimeListeners) listener();
		},
	};
}

describe("subtitle workflow admission", () => {
	it("fails with missing when the material is gone", async () => {
		const h = harness({ materials: [] });
		const outcome = await h.workflow.generate("a");
		expect(outcome).toEqual({
			kind: "failed",
			failure: { kind: "missing-file" },
		});
		expect(h.generation.generate).not.toHaveBeenCalled();
		expect(h.workflow.getSnapshot().failure?.kind).toBe("missing-file");
	});

	it("fails with missing when the audio file is absent", async () => {
		const h = harness({ sourceStat: null, generation: { taskKey: "a" } });
		const outcome = await h.workflow.generate("a");
		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") expect(outcome.failure.kind).toBe("missing-file");
		expect(h.source.readBinary).not.toHaveBeenCalled();
	});

	it("rejects oversized audio before reading it", async () => {
		const h = harness({
			sourceStat: { size: MAX_AUDIO_BYTES + 1, mtime: 10 },
			generation: { taskKey: "a" },
		});
		const outcome = await h.workflow.generate("a");
		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.failure).toMatchObject({
				kind: "audio-too-large",
				maxBytes: MAX_AUDIO_BYTES,
			});
		}
		expect(h.source.readBinary).not.toHaveBeenCalled();
	});

	it("fails with config-missing before any vault read when the configured service is incomplete", async () => {
		const h = harness({ settingsPatch: { bailianWorkspaceId: "" } });
		const outcome = await h.workflow.generate("a");
		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.failure).toMatchObject({
				kind: "config-invalid",
				field: "workspace",
			});
		}
		expect(h.source.stat).not.toHaveBeenCalled();
	});

	it("fails with config-missing when the secret is not configured", async () => {
		const h = harness({ secret: null });
		const outcome = await h.workflow.generate("a");
		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.failure).toMatchObject({
				kind: "config-invalid",
				field: "secret",
			});
		}
	});

	it("surfaces a vault read failure without starting generation", async () => {
		const h = harness({
			generation: { taskKey: "a" },
			readBinary: async () => {
				throw new Error("read boom");
			},
		});
		const outcome = await h.workflow.generate("a");
		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.failure.kind).toBe("unknown");
		}
		expect(h.generation.generate).not.toHaveBeenCalled();
	});

	it("delegates the admitted input and force flag to generation", async () => {
		const h = harness({ generation: { taskKey: "a" } });
		const outcome = await h.workflow.generate("a", true);
		expect(outcome).toEqual({ kind: "applied" });
		expect(h.generation.generate).toHaveBeenCalledTimes(1);
		const [input, generateOptions] = h.generation.generate.mock.calls[0] as unknown as [
			GenerationInput,
			{ force?: boolean },
		];
		expect(input).toMatchObject({
			name: "a.wav",
			taskKey: "a",
			referenceText: "hello",
		});
		expect(input.config).toEqual({
			provider: "bailian",
			workspaceId: "workspace",
			secretId: "secret",
			model: "fun-asr-flash-2026-06-15",
		});
		expect(generateOptions).toEqual({ force: true });
		expect(h.workflow.getSnapshot()).toEqual({ activity: "idle", failure: null });
	});

	it("reports cancellation that lands after generation starts", async () => {
		let resolveGenerate!: () => void;
		const h = harness({ generation: { taskKey: "a" } });
		h.generation.generate.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					resolveGenerate = resolve;
				}),
		);
		const task = h.workflow.generate("a");
		await vi.waitFor(() => expect(h.generation.generate).toHaveBeenCalled());
		h.workflow.cancel();
		resolveGenerate();
		const outcome = await task;
		expect(outcome.kind).toBe("rejected");
		if (outcome.kind === "rejected") expect(outcome.failure.kind).toBe("cancelled");
		expect(h.workflow.getSnapshot()).toEqual({ activity: "idle", failure: null });
	});

	it("rejects a second action while one is running", async () => {
		let resolveRead!: (value: ArrayBuffer) => void;
		const h = harness({
			generation: { taskKey: "a" },
			readBinary: () =>
				new Promise((resolve) => {
					resolveRead = resolve;
				}),
		});
		const first = h.workflow.generate("a");
		await Promise.resolve();
		const second = await h.workflow.generate("a");
		expect(second.kind).toBe("rejected");
		if (second.kind === "rejected") expect(second.failure.kind).toBe("busy");
		h.workflow.cancel();
		resolveRead(new ArrayBuffer(8));
		await first;
		expect(h.generation.generate).not.toHaveBeenCalled();
	});
});

describe("subtitle workflow cancellation fence", () => {
	for (const action of ["cancel", "dispose"] as const) {
		it(`does not start a paid request after ${action} during the vault read`, async () => {
			let resolveRead!: (value: ArrayBuffer) => void;
			const h = harness({
				generation: { taskKey: "a" },
				readBinary: () =>
					new Promise((resolve) => {
						resolveRead = resolve;
					}),
			});
			const task = h.workflow.generate("a");
			await Promise.resolve();
			h.workflow[action]();
			resolveRead(new ArrayBuffer(8));
			const outcome = await task;
			expect(outcome.kind).toBe("rejected");
			if (outcome.kind === "rejected") expect(outcome.failure.kind).toBe("cancelled");
			expect(h.generation.generate).not.toHaveBeenCalled();
			expect(h.generation.cancel).toHaveBeenCalled();
		});
	}
});

describe("subtitle workflow save adoption", () => {
	it("refuses a draft that belongs to another material", async () => {
		const h = harness({ generation: { taskKey: "other" } });
		const outcome = await h.workflow.saveDraft("a");
		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.failure.kind).toBe("stale-material");
		}
		expect(h.runtime.saveSubtitles).not.toHaveBeenCalled();
	});

	it("refuses when the source fingerprint no longer matches", async () => {
		const h = harness({
			generation: { taskKey: "a" },
			matchesSource: async () => false,
		});
		const outcome = await h.workflow.saveDraft("a");
		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") expect(outcome.failure.kind).toBe("source-changed");
		expect(h.runtime.saveSubtitles).not.toHaveBeenCalled();
	});

	it("refuses when the source changed while the bytes were being read", async () => {
		const h = harness({
			generation: { taskKey: "a" },
			sourceStats: [
				{ size: 1024, mtime: 10 },
				{ size: 1024, mtime: 11 },
			],
		});
		const outcome = await h.workflow.saveDraft("a");
		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") expect(outcome.failure.kind).toBe("source-changed");
	});

	it("turns validated-cue rejections into invalid-draft failures", async () => {
		const h = harness({ generation: { taskKey: "a" } });
		h.generation.validatedCues.mockImplementationOnce(() => {
			throw audioFailure({
				kind: "subtitle-invalid",
				problems: [{ kind: "needs-review", cueIndex: 0 }],
			});
		});
		const outcome = await h.workflow.saveDraft("a");
		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.failure).toMatchObject({
				kind: "subtitle-invalid",
				problems: [{ kind: "needs-review", cueIndex: 0 }],
			});
		}
	});

	it("turns subtitle write failures into save-failed failures", async () => {
		const h = harness({ generation: { taskKey: "a" } });
		h.runtime.saveSubtitles.mockRejectedValueOnce(new Error("write boom"));
		const outcome = await h.workflow.saveDraft("a");
		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.failure.kind).toBe("subtitle-write-failed");
		}
	});

	it("writes validated cues through the runtime and reports applied", async () => {
		const h = harness({ generation: { taskKey: "a" } });
		const outcome = await h.workflow.saveDraft("a");
		expect(outcome).toEqual({ kind: "applied" });
		expect(h.generation.validatedCues).toHaveBeenCalledTimes(1);
		expect(h.runtime.saveSubtitles).toHaveBeenCalledWith("a", savedCues);
		expect(h.workflow.getSnapshot()).toEqual({ activity: "idle", failure: null });
	});
});

describe("subtitle workflow draft restoration", () => {
	it("restores the draft when the current material changes", async () => {
		const h = harness({
			materials: [material("a"), material("b")],
			currentMaterialId: "a",
			generation: { taskKey: "a" },
		});
		expect(h.generation.restore).not.toHaveBeenCalled();
		h.switchMaterial("b");
		await vi.waitFor(() => {
			expect(h.generation.restore).toHaveBeenCalledWith("b");
		});
	});

	it("waits for an in-flight generation before restoring", async () => {
		const h = harness({
			materials: [material("a"), material("b")],
			currentMaterialId: "a",
			generation: { taskKey: "a", status: "transcribing" },
		});
		h.switchMaterial("b");
		expect(h.generation.restore).not.toHaveBeenCalled();
	});

	it("keeps the failure until the next action acknowledges it", async () => {
		const h = harness({ sourceStat: null, generation: { taskKey: "a" } });
		await h.workflow.generate("a");
		expect(h.workflow.getSnapshot().failure?.kind).toBe("missing-file");
		h.workflow.dismissFailure();
		expect(h.workflow.getSnapshot().failure).toBeNull();
	});

	it("drops subscriptions on dispose", () => {
		const h = harness({ generation: { taskKey: "a" } });
		h.workflow.dispose();
		h.switchMaterial("b");
		expect(h.generation.restore).not.toHaveBeenCalled();
	});
});
