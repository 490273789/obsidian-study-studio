import type { ShadowAudioChunk, ShadowVideoSource } from "../domain/shadowSubtitlesJobs";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import type * as FileSystem from "node:fs/promises";

export interface ShadowAudioExtractorOptions {
	ffmpegPath?: string;
	ffprobePath?: string;
	requireModule: (id: string) => unknown;
	timeoutMs?: number;
}
/** Desktop adapter. Node modules are resolved by the owning Obsidian window. */
export function createDesktopShadowAudioExtractor(
	options: ShadowAudioExtractorOptions,
): (source: ShadowVideoSource, offset: number, signal: AbortSignal) => Promise<ShadowAudioChunk> {
	const fs = options.requireModule("node:fs/promises") as typeof FileSystem;
	const { spawn } = options.requireModule("node:child_process") as {
		spawn(this: void, command: string, args: string[], options: SpawnOptions): ChildProcess;
	};
	const { tmpdir } = options.requireModule("node:os") as { tmpdir(this: void): string };
	const { join } = options.requireModule("node:path") as {
		join(this: void, ...paths: string[]): string;
	};
	const siblingProbe =
		options.ffmpegPath && /ffmpeg(\.exe)?$/i.test(options.ffmpegPath)
			? options.ffmpegPath.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1")
			: null;
	const run = (command: string, args: string[], signal: AbortSignal): Promise<string> =>
		new Promise((resolve, reject) => {
			if (signal.aborted) {
				reject(new Error("已取消"));
				return;
			}
			const process = spawn(command, args, {
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let output = "";
			let errorOutput = "";
			let settled = false;
			const finish = (error?: Error): void => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				signal.removeEventListener("abort", abort);
				if (error) reject(error);
				else resolve(output);
			};
			const abort = (): void => {
				process.kill("SIGKILL");
				finish(new Error("已取消"));
			};
			const timer = setTimeout(() => {
				process.kill("SIGKILL");
				finish(new Error("音轨提取超时。"));
			}, options.timeoutMs ?? 120_000);
			signal.addEventListener("abort", abort, { once: true });
			process.stdout?.on("data", (data: Uint8Array) => {
				output += new TextDecoder().decode(data);
				if (output.length > 1_048_576) {
					process.kill("SIGKILL");
					finish(new Error("媒体信息过大。"));
				}
			});
			process.stderr?.on("data", (data: Uint8Array) => {
				errorOutput = (errorOutput + new TextDecoder().decode(data)).slice(-4096);
			});
			process.once("error", (error) => finish(error));
			process.once("close", (code) =>
				finish(code === 0 ? undefined : new Error(`媒体处理失败：${errorOutput || code}`)),
			);
		});
	return async (source, offset, signal) => {
		const stat = await fs.stat(source.path);
		const sourceSignature = `${stat.size}:${stat.mtimeMs}`;
		const metadata = JSON.parse(
			await run(
				options.ffprobePath || siblingProbe || "ffprobe",
				[
					"-v",
					"error",
					"-show_entries",
					"format=duration:stream=codec_type",
					"-of",
					"json",
					source.path,
				],
				signal,
			),
		) as { format?: { duration?: string }; streams?: { codec_type?: string }[] };
		const totalDuration = Number(metadata.format?.duration);
		if (!Number.isFinite(totalDuration) || totalDuration <= 0)
			throw new Error("无法读取视频时长。");
		if (metadata.streams?.filter((stream) => stream.codec_type === "audio").length !== 1)
			throw new Error("请提供仅含一条音轨的视频。");
		if (!Number.isFinite(offset) || offset < 0 || offset >= totalDuration)
			throw new Error("提取范围无效。");
		const directory = await fs.mkdtemp(join(tmpdir(), "study-studio-shadow-"));
		try {
			const output = join(directory, "chunk.wav");
			const duration = Math.min(60, totalDuration - offset);
			await run(
				options.ffmpegPath || "ffmpeg",
				[
					"-nostdin",
					"-v",
					"error",
					"-ss",
					String(offset),
					"-i",
					source.path,
					"-t",
					String(duration),
					"-map",
					"0:a:0",
					"-vn",
					"-ac",
					"1",
					"-ar",
					"16000",
					"-c:a",
					"pcm_s16le",
					"-fs",
					"4194304",
					output,
				],
				signal,
			);
			if (signal.aborted) throw new Error("已取消");
			const buffer = await fs.readFile(output);
			if (buffer.byteLength >= 4 * 1024 * 1024) throw new Error("音轨片段超出大小限制。");
			const after = await fs.stat(source.path);
			if (`${after.size}:${after.mtimeMs}` !== sourceSignature)
				throw new Error("视频文件在提取期间发生变化。");
			return {
				audio: Uint8Array.from(buffer).buffer,
				duration,
				totalDuration,
				sourceSignature,
			};
		} finally {
			await fs.rm(directory, { recursive: true, force: true });
		}
	};
}
export async function shadowVideoSourceSignature(
	path: string,
	requireModule: (id: string) => unknown,
): Promise<string> {
	const fs = requireModule("node:fs/promises") as typeof FileSystem;
	const stat = await fs.stat(path);
	return `${stat.size}:${stat.mtimeMs}`;
}
