import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const source = "src/features/flashcards/domain/sessions/sessionPersistence.ts";
const commands = new Set([`cat ${source}`, `/bin/cat ${source}`]);
const event = JSON.parse(readFileSync(0, "utf8"));

// Bash hooks report a command and its output. Check both for this single-file pilot.
if (
	event.hook_event_name === "PostToolUse" &&
	event.tool_name === "Bash" &&
	event.cwd === root &&
	commands.has(event.tool_input?.command) &&
	typeof event.tool_response === "string" &&
	event.tool_response === readFileSync(resolve(root, source), "utf8")
) {
	const rulePath = ".claude/rules/session-persistence.md";
	const guide = readFileSync(resolve(root, rulePath), "utf8");
	const section = guide.match(/^## Session persistence\r?\n[\s\S]+/m)?.[0].trimEnd();
	if (!section) throw new Error("Missing session persistence rule");

	console.log(
		JSON.stringify({
			hookSpecificOutput: {
				hookEventName: "PostToolUse",
				additionalContext: `From ${rulePath}\n\n${section}`,
			},
		}),
	);
}
