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
	const guide = readFileSync(resolve(root, "docs/agents/sessions.md"), "utf8");
	const section = guide.split(/^## /m).find((part) => /^Session persistence\r?\n/.test(part));
	if (!section)
		throw new Error("Session persistence section is missing from docs/agents/sessions.md");

	console.log(
		JSON.stringify({
			hookSpecificOutput: {
				hookEventName: "PostToolUse",
				additionalContext: `From docs/agents/sessions.md\n\n## ${section.trimEnd()}`,
			},
		}),
	);
}
