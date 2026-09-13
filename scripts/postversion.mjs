import { execSync } from "node:child_process";

const version = process.env.npm_package_version;
if (version) {
	try {
		// 检查是否存在带 v 前缀的 tag (如 pnpm version / pn version 默认生成的 v5.0.0)
		// 如果存在，将其修正为项目 CI 规范的不带 v 前缀的 tag (如 5.0.0)
		execSync(`git rev-parse --verify "refs/tags/v${version}"`, { stdio: "ignore" });
		execSync(`git tag "${version}" "v${version}" && git tag -d "v${version}"`, {
			stdio: "ignore",
		});
		console.log(
			`\x1b[32m✔\x1b[0m 自动将 tag "v${version}" 修正为 "${version}"（符合项目发布规范）`,
		);
	} catch {
		// 不存在带 v 前缀的 tag（如通过 pnpm release:* 正常生成），无需处理
	}
}
