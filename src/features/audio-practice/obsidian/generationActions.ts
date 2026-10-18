import type { AudioMaterial } from "../domain/types";
import type { GenerationInput, SubtitleGeneration } from "../generation/subtitleGeneration";

/** A vault read cannot be aborted. Fence it before it can start a paid request. */
export class AudioGenerationActions {
	private epoch = 0;
	private disposed = false;
	constructor(
		private readonly ports: {
			readInput(material: AudioMaterial): Promise<GenerationInput>;
			generation: Pick<SubtitleGeneration, "generate" | "cancel">;
		},
	) {}
	async run(material: AudioMaterial, force = false): Promise<void> {
		if (this.disposed) return;
		const epoch = this.epoch;
		const input = await this.ports.readInput(material);
		if (this.disposed || epoch !== this.epoch) return;
		await this.ports.generation.generate(input, { force });
	}
	cancel(): void {
		this.epoch++;
		this.ports.generation.cancel();
	}
	dispose(): void {
		this.disposed = true;
		this.cancel();
	}
}
