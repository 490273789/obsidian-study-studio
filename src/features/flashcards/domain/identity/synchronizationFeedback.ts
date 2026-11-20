import { translate } from "../../strings/index";
import type { Language } from "../../../../core/shared/types";
import type {
	CardChangeOutcome,
	CardIdentityContinuitySnapshot,
	CardIdentityIssue,
	CardValidationError,
	SynchronizeOutcome,
} from "./cardIdentityContinuity";

export function describeCardChangeOutcome(
	outcome: Exclude<CardChangeOutcome, { kind: "applied" }>,
	language: Language,
): string {
	switch (outcome.kind) {
		case "blocked":
			return outcome.reason === "migration-required"
				? translate(language, "identity.editNeedsMigration")
				: translate(language, "identity.editNeedsRepair");
		case "source-changing":
			return translate(language, "identity.sourceChanging");
		case "validation-failed":
			return describeCardValidationError(outcome.error, language);
		case "failed":
			return outcome.message;
	}
}

function describeCardValidationError(error: CardValidationError, language: Language): string {
	switch (error.type) {
		case "missing-front":
			return translate(language, "cardEditor.frontRequired");
		case "missing-back":
			return translate(language, "cardEditor.backRequired");
		case "reserved-marker":
			return translate(language, "cardEditor.markerReserved");
		case "card-not-found":
		case "source-file-invalid":
			return translate(language, "notice.cardMissing");
	}
}

export function describeSynchronizationOutcome(
	outcome: SynchronizeOutcome,
	snapshot: CardIdentityContinuitySnapshot,
	language: Language,
): string | null {
	if (outcome.kind === "current") return null;
	if (outcome.kind === "failed") {
		return translate(language, "identity.syncFailed", { message: outcome.message });
	}

	const unreadablePaths = outcome.change.unreadablePaths;
	const readWarning = unreadablePaths?.length
		? translate(language, "identity.syncUnreadable", {
				sources: formatSources(unreadablePaths, language),
			})
		: null;
	const issue = findReportedIssue(outcome.issueIds, snapshot.issues);
	if (!issue) return readWarning ?? translate(language, "identity.syncAttention");

	const sources = formatSources(issue.affectedSources, language);
	const more = formatRemainingIssues(outcome.issueIds.length - 1, language);
	const command = translate(language, "main.commandRepairCardIdentities");

	const identityWarning =
		issue.type === "identity-conflict"
			? translate(language, "identity.syncConflictDetails", {
					sources,
					identity: issue.identity,
					card: formatCandidateName(issue),
					command,
					more,
				})
			: translate(language, "identity.syncAmbiguityDetails", {
					sources,
					count: issue.missingIdentities.length,
					command,
					more,
				});
	return readWarning ? `${readWarning}\n${identityWarning}` : identityWarning;
}

function findReportedIssue(
	issueIds: string[],
	issues: CardIdentityIssue[],
): CardIdentityIssue | undefined {
	for (const issueId of issueIds) {
		const issue = issues.find((candidate) => candidate.id === issueId);
		if (issue) return issue;
	}
	return issues[0];
}

function formatSources(sources: readonly string[], language: Language): string {
	return sources.join(language === "zh" ? "、" : ", ");
}

function formatRemainingIssues(count: number, language: Language): string {
	if (count <= 0) return "";
	const message = translate(language, "identity.syncMoreIssues", { count });
	return language === "zh" ? message : ` ${message}`;
}

function formatCandidateName(
	issue: Extract<CardIdentityIssue, { type: "identity-conflict" }>,
): string {
	const firstLine = issue.candidates[0]?.front.split(/\r?\n/)[0]?.trim();
	return firstLine?.replace(/^#+\s*/, "") || issue.identity;
}
