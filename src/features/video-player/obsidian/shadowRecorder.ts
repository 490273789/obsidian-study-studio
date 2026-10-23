import type { ShadowRecorderPort } from "../domain/shadowingSession";

/** Owns microphone tracks and object URLs. Cancellation also handles a late permission grant. */
export function createShadowRecorder(ownerWindow: Window): ShadowRecorderPort {
	const host = ownerWindow as Window & typeof globalThis;
	let generation = 0;
	let stream: MediaStream | null = null;
	let recorder: MediaRecorder | null = null;
	let stopping: Promise<Blob> | null = null;
	let rejectRecording: ((error: Error) => void) | null = null;
	let player: HTMLAudioElement | null = null;
	let url: string | null = null;
	let rejectPlayback: ((error: Error) => void) | null = null;
	let disposed = false;
	const releaseTracks = () => {
		stream?.getTracks().forEach((track) => track.stop());
		stream = null;
	};
	const stopPlayback = () => {
		player?.pause();
		if (player) {
			player.removeAttribute("src");
			player.load();
		}
		player = null;
		if (url) host.URL.revokeObjectURL(url);
		url = null;
		rejectPlayback?.(new Error("回听已停止"));
		rejectPlayback = null;
	};
	const cancel = () => {
		generation++;
		const current = recorder;
		recorder = null;
		if (current && current.state !== "inactive") current.stop();
		rejectRecording?.(new Error("录音已取消"));
		rejectRecording = null;
		stopping = null;
		releaseTracks();
		stopPlayback();
	};
	return {
		async start() {
			cancel();
			if (disposed) throw new Error("录音器已关闭");
			if (!host.navigator.mediaDevices?.getUserMedia || !host.MediaRecorder)
				throw new Error("当前窗口不支持麦克风录音");
			const token = generation;
			const acquired = await host.navigator.mediaDevices.getUserMedia({ audio: true });
			if (token !== generation || disposed) {
				acquired.getTracks().forEach((track) => track.stop());
				throw new Error("录音已取消");
			}
			stream = acquired;
			try {
				const mimeType = [
					"audio/webm;codecs=opus",
					"audio/ogg;codecs=opus",
					"audio/webm",
					"audio/mp4",
				].find((type) => host.MediaRecorder.isTypeSupported(type));
				const current = new host.MediaRecorder(
					acquired,
					mimeType ? { mimeType } : undefined,
				);
				recorder = current;
				const chunks: Blob[] = [];
				stopping = new Promise<Blob>((resolve, reject) => {
					rejectRecording = reject;
					current.addEventListener("dataavailable", (event: BlobEvent) => {
						if (event.data.size) chunks.push(event.data);
					});
					current.addEventListener("error", () => {
						releaseTracks();
						reject(new Error("麦克风录音失败，请重试"));
					});
					current.addEventListener("stop", () => {
						if (token !== generation) return;
						rejectRecording = null;
						recorder = null;
						releaseTracks();
						resolve(
							new Blob(chunks, {
								type: current.mimeType || chunks[0]?.type || "audio/webm",
							}),
						);
					});
					for (const track of acquired.getAudioTracks())
						track.addEventListener("ended", () => {
							if (current.state !== "inactive") {
								current.stop();
								reject(new Error("麦克风已断开，请重试"));
							}
						});
				});
				// The result may fail before stop() is called; attach a handler immediately.
				void stopping.catch(() => undefined);
				current.start();
			} catch (error) {
				cancel();
				throw error;
			}
		},
		async stop() {
			const result = stopping;
			if (!result) throw new Error("没有正在进行的录音");
			if (recorder?.state !== "inactive") recorder?.stop();
			return result;
		},
		cancel,
		async play(blob) {
			stopPlayback();
			if (disposed) return;
			url = host.URL.createObjectURL(blob);
			const audio = new host.Audio(url);
			player = audio;
			return new Promise<void>((resolve, reject) => {
				rejectPlayback = reject;
				audio.addEventListener(
					"ended",
					() => {
						rejectPlayback = null;
						stopPlayback();
						resolve();
					},
					{ once: true },
				);
				audio.addEventListener(
					"error",
					() => {
						rejectPlayback = null;
						stopPlayback();
						reject(new Error("录音回听失败"));
					},
					{ once: true },
				);
				void audio.play().catch((error: unknown) => {
					rejectPlayback = null;
					stopPlayback();
					reject(error);
				});
			});
		},
		dispose() {
			disposed = true;
			cancel();
		},
	};
}
