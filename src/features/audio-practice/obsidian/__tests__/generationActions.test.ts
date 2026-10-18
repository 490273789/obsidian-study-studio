import { describe, expect, it, vi } from "vite-plus/test";
import { AudioGenerationActions } from "../generationActions";
import type { GenerationInput } from "../../generation/subtitleGeneration";

const material = { id: "a", title: "A", audioPath: "a.wav", subtitlePath: null, originalText: "" };
const input: GenerationInput = {
	taskKey: "a",
	name: "a.wav",
	audio: new ArrayBuffer(2),
	config: {
		provider: "bailian",
		workspaceId: "workspace",
		secretId: "secret-id",
		model: "fun-asr-flash-2026-06-15",
	},
};

describe("vault read and generation lifetime", () => {
	for (const action of ["cancel", "dispose"] as const) {
		it(`does not upload after ${action} during a vault read`, async () => {
			let resolve!: (input: GenerationInput) => void;
			const generation = { generate: vi.fn(async () => {}), cancel: vi.fn() };
			const actions = new AudioGenerationActions({
				readInput: () =>
					new Promise((done) => {
						resolve = done;
					}),
				generation,
			});
			const task = actions.run(material, true);
			actions[action]();
			resolve(input);
			await task;
			expect(generation.generate).not.toHaveBeenCalled();
		});
	}
	it("rereads the input for resumed work without forcing paid retranscription", async () => {
		const generation = { generate: vi.fn(async () => {}), cancel: vi.fn() };
		const readInput = vi.fn(async () => input);
		const actions = new AudioGenerationActions({ readInput, generation });
		await actions.run(material, false);
		expect(readInput).toHaveBeenCalledWith(material);
		expect(generation.generate).toHaveBeenCalledWith(input, { force: false });
	});
});
