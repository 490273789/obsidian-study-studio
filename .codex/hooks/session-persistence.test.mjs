import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const source = "src/features/flashcards/domain/sessions/sessionPersistence.ts";
const event = {
	cwd: root,
	hook_event_name: "PostToolUse",
	tool_name: "Bash",
	tool_input: { command: `cat ${source}` },
	tool_response: readFileSync(resolve(root, source), "utf8"),
};

function runHook(overrides) {
	return execFileSync(
		process.execPath,
		[resolve(import.meta.dirname, "session-persistence.mjs")],
		{
			input: JSON.stringify({ ...event, ...overrides }),
			encoding: "utf8",
		},
	);
}

test("injects the original session persistence section after a matching read", () => {
	const output = JSON.parse(runHook());
	const guide = readFileSync(resolve(root, "docs/agents/sessions.md"), "utf8");
	const section = guide.match(/^## Session persistence\r?\n[\s\S]+?(?=^## )/m)[0].trimEnd();

	assert.equal(output.hookSpecificOutput.hookEventName, "PostToolUse");
	assert.equal(
		output.hookSpecificOutput.additionalContext,
		`From docs/agents/sessions.md\n\n${section}`,
	);
});

test("ignores unrelated reads and shell commands that only mention the path", () => {
	for (const command of [
		"cat src/core/host/main.ts",
		`echo ${source}`,
		`cat unrelated.ts # ${source}`,
		`cat ${source} | head`,
	]) {
		assert.equal(runHook({ tool_input: { command } }), "", command);
	}
});

test("requires a full matching result from a repository-root read", () => {
	assert.equal(runHook({ tool_response: "cat: file not found" }), "");
	assert.equal(runHook({ cwd: resolve(root, "src") }), "");
});
