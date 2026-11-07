import { stat } from "node:fs/promises";

const budgets = [
	{ path: "main.js", maxBytes: 2_500_000 },
	{ path: "styles.css", maxBytes: 260_000 },
];

let exceeded = false;
for (const budget of budgets) {
	const size = (await stat(budget.path)).size;
	console.log(`${budget.path}: ${size} bytes (budget ${budget.maxBytes})`);
	if (size > budget.maxBytes) {
		console.error(`${budget.path} exceeds its committed artifact budget.`);
		exceeded = true;
	}
}

if (exceeded) process.exitCode = 1;
