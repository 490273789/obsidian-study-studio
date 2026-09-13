#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const msgPath = process.argv[2];
if (!msgPath) {
	console.error("\x1b[31m[ERROR]\x1b[0m 未指定 commit message 文件路径。");
	process.exit(1);
}

const resolvedPath = path.resolve(process.cwd(), msgPath);
if (!fs.existsSync(resolvedPath)) {
	console.error(`\x1b[31m[ERROR]\x1b[0m 找不到 commit message 文件: ${resolvedPath}`);
	process.exit(1);
}

const rawContent = fs.readFileSync(resolvedPath, "utf8");
// 过滤掉注释行
const lines = rawContent.split("\n").filter((line) => !line.trim().startsWith("#"));
const commitMsg = lines.join("\n").trim();

if (!commitMsg) {
	console.error("\x1b[31m[ERROR]\x1b[0m Commit message 不能为空。");
	process.exit(1);
}

// 针对自动生成的特殊提交直接放行
if (
	/^Merge (branch|tag|remote-tracking branch|pull request)/i.test(commitMsg) ||
	/^Revert ".+"/i.test(commitMsg) ||
	commitMsg.startsWith("Initial commit")
) {
	process.exit(0);
}

const firstLine = commitMsg.split("\n")[0].trim();

// 针对版本发布（如 pnpm/pn version major 等）生成的提交信息进行智能规范化
// 1. 纯版本号: "5.0.0", "v5.0.0" -> "chore(release): bump version to 5.0.0"
// 2. 简短或拼写偏差版本信息: "chore(release): 5.0.0", "chore(realease): bump version to 5.0.0"
const semverPattern = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;
const shortReleasePattern =
	/^chore\((?:release|realease)\):\s*(?:bump\s+version\s+to\s+)?(?:v)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/i;

const semverMatch = firstLine.match(semverPattern);
const shortReleaseMatch = firstLine.match(shortReleasePattern);

if (semverMatch || shortReleaseMatch) {
	const version = semverMatch ? semverMatch[1] : shortReleaseMatch[1];
	const normalizedFirstLine = `chore(release): bump version to ${version}`;
	const allLines = rawContent.split("\n");
	let replaced = false;
	const newLines = allLines.map((line) => {
		if (!replaced && line.trim() === firstLine) {
			replaced = true;
			return normalizedFirstLine;
		}
		return line;
	});
	if (!replaced) {
		newLines[0] = normalizedFirstLine;
	}
	fs.writeFileSync(resolvedPath, newLines.join("\n"), "utf8");
	console.log(`\x1b[32m✔\x1b[0m 自动将版本提交信息规范化为: "${normalizedFirstLine}"`);
	console.log("\x1b[32m✔ Commit message 格式检查通过\x1b[0m");
	process.exit(0);
}

// Conventional Commits 正则
// 允许格式: <type>(<scope>): <subject> 或 <type>: <subject>
// 也支持带感叹号的 breaking change: <type>(<scope>)!: <subject>
const commitPattern =
	/^(feat|fix|style|refactor|perf|test|docs|chore|revert)(\(([a-zA-Z0-9_\-/,]+)\))?(!)?: (.+)$/;

const match = firstLine.match(commitPattern);

const validTypes = ["feat", "fix", "style", "refactor", "perf", "test", "docs", "chore", "revert"];

const recommendedScopes = [
	"ui",
	"styles",
	"cards",
	"parser",
	"identity",
	"session",
	"pronunciation",
	"deck",
	"obsidian",
	"settings",
	"storage",
	"history",
	"word-list",
	"i18n",
	"deps",
	"release",
];

if (!match) {
	console.error(
		"\n\x1b[31m================== ❌ Git Commit Message 格式校验失败 ==================\x1b[0m\n",
	);
	console.error(`\x1b[33m当前提交信息:\x1b[0m\n  "${firstLine}"\n`);
	console.error("\x1b[36m标准格式:\x1b[0m");
	console.error("  <type>(<scope>): <subject>\n");
	console.error("\x1b[36m支持的 Type:\x1b[0m");
	console.error(`  ${validTypes.join(", ")}\n`);
	console.error("\x1b[36m推荐的 Scope:\x1b[0m");
	console.error(`  ${recommendedScopes.join(", ")}\n`);
	console.error("\x1b[32m正确示范:\x1b[0m");
	console.error("  feat(ui): add drag and drop function to sort list");
	console.error("  fix(session): correct practice session range calculation");
	console.error("  style(ui): adjust card review button padding");
	console.error("  chore(release): bump version to 4.5.1\n");
	console.error(
		"\x1b[31m========================================================================\x1b[0m\n",
	);
	process.exit(1);
}

const [, , , scope, , subject] = match;

// 检查 subject 是否过于简单无意义
const lowerSubject = subject.trim().toLowerCase();
const invalidSubjects = ["update", "fix", "ui update", "update ui", "fix bug", "modify", "change"];

if (invalidSubjects.includes(lowerSubject) || lowerSubject.length < 3) {
	console.error(
		"\n\x1b[31m================== ❌ Commit Subject 过于模糊 ==================\x1b[0m\n",
	);
	console.error(`\x1b[33m当前提交信息:\x1b[0m "${firstLine}"`);
	console.error(
		'\x1b[33m原因:\x1b[0m 描述内容过于简略或属于无意义短语（如 "update", "ui update", "fix bug"）。',
	);
	console.error(
		"请提供具体、清晰的修改意图说明（例如：`style(ui): adjust card review button padding`）。\n",
	);
	console.error(
		"\x1b[31m================================================================\x1b[0m\n",
	);
	process.exit(1);
}

// 检查 scope 是否在推荐列表中，如不在给出提示但不强行阻断（支持扩展）
if (scope && !recommendedScopes.includes(scope)) {
	console.warn(
		`\x1b[33m[WARN]\x1b[0m Scope "${scope}" 不在项目推荐列表中。推荐列表: ${recommendedScopes.join(", ")}`,
	);
}

console.log("\x1b[32m✔ Commit message 格式检查通过\x1b[0m");
process.exit(0);
