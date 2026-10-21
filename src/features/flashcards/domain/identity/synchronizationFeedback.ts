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

	const issue = findReportedIssue(outcome.issueIds, snapshot.issues);
	if (!issue) return translate(language, "identity.syncAttention");

	const sources = formatSources(issue.affectedSources, language);
	const more = formatRemainingIssues(outcome.issueIds.length - 1, language);
	const command = translate(language, "main.commandRepairCardIdentities");

	if (issue.type === "identity-conflict") {
		return translate(language, "identity.syncConflictDetails", {
			sources,
			identity: issue.identity,
			card: formatCandidateName(issue),
			command,
			more,
		});
	}

	return translate(language, "identity.syncAmbiguityDetails", {
		sources,
		count: issue.missingIdentities.length,
		command,
		more,
	});
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

function formatSources(sources: string[], language: Language): string {
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
