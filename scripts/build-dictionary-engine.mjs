import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const rustVersion = "1.95.0";
const bindgenVersion = "0.2.127";
function output(command, args) {
	return execFileSync(command, args, { encoding: "utf8" }).trim();
}
if (
	output("rustc", ["--version"]).split(" ")[1] !== rustVersion ||
	output("wasm-bindgen", ["--version"]) !== `wasm-bindgen ${bindgenVersion}`
) {
	throw new Error(
		`Dictionary builds require Rust ${rustVersion} and wasm-bindgen-cli ${bindgenVersion}`,
	);
}

const target = resolve(process.env.CARGO_TARGET_DIR || "target");
const flags = [
	[process.cwd(), "/study-studio"],
	[resolve(process.env.CARGO_HOME || join(homedir(), ".cargo")), "/cargo"],
	[output("rustc", ["--print", "sysroot"]), "/rust"],
].map(([from, to]) => `--remap-path-prefix=${from}=${to}`);
execFileSync(
	"cargo",
	[
		"build",
		"--locked",
		"--release",
		"--target-dir",
		target,
		"--target",
		"wasm32-unknown-unknown",
		"-p",
		"dictionary-engine",
	],
	{
		env: { ...process.env, CARGO_ENCODED_RUSTFLAGS: flags.join("\x1f") },
		stdio: "inherit",
	},
);
execFileSync(
	"wasm-bindgen",
	[
		join(target, "wasm32-unknown-unknown/release/dictionary_engine.wasm"),
		"--target",
		"web",
		"--out-dir",
		"src/features/dictionary/domain/engine",
		"--out-name",
		"dictionary_engine",
	],
	{ stdio: "inherit" },
);
