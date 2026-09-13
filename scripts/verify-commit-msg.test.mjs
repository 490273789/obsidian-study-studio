import assert from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scriptPath = path.resolve(import.meta.dirname, "verify-commit-msg.mjs");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "commit-msg-test-"));

function runTest(inputMsg) {
	const file = path.join(tmpDir, "COMMIT_EDITMSG");
	fs.writeFileSync(file, inputMsg, "utf8");
	let code = 0;
	let stdout = "";
	let stderr = "";
	try {
		stdout = execFileSync(process.execPath, [scriptPath, file], { encoding: "utf8" });
	} catch (err) {
		code = err.status ?? 1;
		stdout = err.stdout?.toString() ?? "";
		stderr = err.stderr?.toString() ?? "";
	}
	const resultMsg = fs.readFileSync(file, "utf8").trim();
	return { code, resultMsg, stdout, stderr };
}

try {
	// Test 1: 纯版本号 (pnpm version major 默认传递)
	const res1 = runTest("5.0.0");
	assert.strictEqual(res1.code, 0);
	assert.strictEqual(res1.resultMsg, "chore(release): bump version to 5.0.0");

	// Test 2: 带 v 前缀的版本号
	const res2 = runTest("v5.0.0");
	assert.strictEqual(res2.code, 0);
	assert.strictEqual(res2.resultMsg, "chore(release): bump version to 5.0.0");

	// Test 3: chore(release): 5.0.0 简写
	const res3 = runTest("chore(release): 5.0.0");
	assert.strictEqual(res3.code, 0);
	assert.strictEqual(res3.resultMsg, "chore(release): bump version to 5.0.0");

	// Test 4: 容错用户拼写 chore(realease): bump version to 5.0.0
	const res4 = runTest("chore(realease): bump version to 5.0.0");
	assert.strictEqual(res4.code, 0);
	assert.strictEqual(res4.resultMsg, "chore(release): bump version to 5.0.0");

	// Test 5: 标准 conventional commit
	const res5 = runTest("feat(ui): add review action buttons");
	assert.strictEqual(res5.code, 0);
	assert.strictEqual(res5.resultMsg, "feat(ui): add review action buttons");

	// Test 6: 模糊 subject (拦截)
	const res6 = runTest("feat(ui): update");
	assert.strictEqual(res6.code, 1);

	// Test 7: 无效格式 (拦截)
	const res7 = runTest("just random message");
	assert.strictEqual(res7.code, 1);

	console.log("All verify-commit-msg tests passed successfully!");
} finally {
	fs.rmSync(tmpDir, { recursive: true, force: true });
}
