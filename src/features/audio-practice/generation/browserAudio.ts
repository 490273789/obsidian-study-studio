import { MAX_AUDIO_BYTES, MAX_AUDIO_DURATION_SECONDS } from "./limits";
import type { PrepareAudio } from "./types";

export function encodeMonoWav(samples: Float32Array, sampleRate = 16000): ArrayBuffer {
	const buffer = new ArrayBuffer(44 + samples.length * 2);
	const view = new DataView(buffer);
	const write = (offset: number, text: string) => {
		for (let index = 0; index < text.length; index++)
			view.setUint8(offset + index, text.charCodeAt(index));
	};
	write(0, "RIFF");
	view.setUint32(4, buffer.byteLength - 8, true);
	write(8, "WAVE");
	write(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	write(36, "data");
	view.setUint32(40, samples.length * 2, true);
	for (let index = 0; index < samples.length; index++) {
		const value = Math.max(-1, Math.min(1, samples[index] ?? 0));
		view.setInt16(44 + index * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
	}
	return buffer;
}

export function createBrowserAudioPreparation(
	getWindow: () => Window = () => window,
): PrepareAudio {
	return async (audio, signal) => {
		signal.throwIfAborted();
		if (audio.byteLength > MAX_AUDIO_BYTES)
			throw new Error("生成字幕仅支持 50 MiB 以内的音频。");
		const browser = getWindow() as Window & typeof globalThis;
		const context = new browser.AudioContext();
		try {
			const decoded = await context.decodeAudioData(audio.slice(0));
			signal.throwIfAborted();
			if (
				!Number.isFinite(decoded.duration) ||
				decoded.duration <= 0 ||
				decoded.duration > MAX_AUDIO_DURATION_SECONDS
			)
				throw new Error("生成字幕仅支持 10 分钟以内的有效音频。");
			const renderer = new browser.OfflineAudioContext(
				1,
				Math.ceil(decoded.duration * 16000),
				16000,
			);
			const source = renderer.createBufferSource();
			source.buffer = decoded;
			source.connect(renderer.destination);
			source.start();
			const mono = (await renderer.startRendering()).getChannelData(0);
			signal.throwIfAborted();
			const chunks = [];
			for (let start = 0, index = 0; start < decoded.duration; start += 59, index++) {
				const end = Math.min(start + 60, decoded.duration);
				chunks.push({
					index,
					start,
					end,
					wav: encodeMonoWav(mono.slice(start * 16000, Math.ceil(end * 16000))),
				});
				if (end === decoded.duration) break;
			}
			return { duration: decoded.duration, chunks };
		} finally {
			await context.close();
		}
	};
}
