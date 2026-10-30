import { describe, expect, it } from "vite-plus/test";
import { encodeMonoWav } from "../transcription/browserAudio";

describe("browser audio encoding", () => {
	it("writes PCM WAV metadata and clips samples", () => {
		const wav = new DataView(encodeMonoWav(new Float32Array([-2, 0, 2])));
		expect(wav.getUint32(24, true)).toBe(16000);
		expect(wav.getUint16(22, true)).toBe(1);
		expect(wav.getInt16(44, true)).toBe(-32768);
		expect(wav.getInt16(48, true)).toBe(32767);
	});
});
