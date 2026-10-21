import React from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import type { ChallengeReadiness } from "../../../domain/decks/deckHome";
import { ChallengeSetupModal } from "../Challenge/ChallengeSetupModal";

const hooks = vi.hoisted(() => ({ mode: undefined as string | undefined }));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useState: (initial: string) => [hooks.mode ?? initial, (next: string) => (hooks.mode = next)],
	useId: () => "challenge-setup",
}));
vi.mock("../../../strings/context", () => ({
	useFlashcardI18n: () => ({ t: (key: string) => key }),
}));

const readiness: Omit<ChallengeReadiness, "savedRoundId"> = {
	eligibleCount: 20,
	lastMode: "normal",
	round: {
		id: "round",
		mode: "normal",
		completedLevelCount: 1,
		totalLevels: 3,
		completedCardCount: 10,
		totalCards: 20,
	},
};
type Props = React.ComponentProps<typeof ChallengeSetupModal>;
type ChildProps = {
	children?: React.ReactNode;
	variant?: string;
	disabled?: boolean;
	onClick?: () => void;
	onChange?: () => void;
};
function elements(node: React.ReactNode): React.ReactElement<ChildProps>[] {
	const result: React.ReactElement<ChildProps>[] = [];
	React.Children.forEach(node, (child) => {
		if (React.isValidElement<ChildProps>(child))
			result.push(child, ...elements(child.props.children));
	});
	return result;
}
function render(props: Partial<Props> = {}) {
	const onStart = vi.fn();
	const modal = (
		ChallengeSetupModal as unknown as { type: (props: Props) => React.ReactElement }
	).type({ readiness, isStarting: false, onStart, onClose: vi.fn(), ...props });
	const children = (
		modal.props as {
			children: (value: {
				requestClose: () => void;
				initialFocusProps: object;
			}) => React.ReactNode;
		}
	).children({ requestClose: vi.fn(), initialFocusProps: {} });
	const all = elements(children);
	return {
		onStart,
		all,
		button: (label: string) =>
			all.find(
				(element) => element.type === FlashcardButton && element.props.children === label,
			)?.props,
	};
}

beforeEach(() => {
	hooks.mode = undefined;
});

describe("challenge setup actions", () => {
	it("emphasizes continuing the matching saved round and preserves both intents", () => {
		const page = render();
		expect(page.button("challenge.continue")?.variant).toBe("primary");
		expect(page.button("challenge.restart")?.variant).toBe("secondary");
		page.button("challenge.continue")?.onClick?.();
		page.button("challenge.restart")?.onClick?.();
		expect(page.onStart.mock.calls).toEqual([
			["normal", "continue"],
			["normal", "new"],
		]);
	});

	it("starts a new round for a different mode without offering incompatible resume", () => {
		hooks.mode = "spelling";
		const page = render();
		expect(page.button("challenge.continue")).toBeUndefined();
		expect(page.button("challenge.newChallenge")?.variant).toBe("primary");
		page.button("challenge.newChallenge")?.onClick?.();
		expect(page.onStart).toHaveBeenCalledWith("spelling", "new");
	});

	it("offers the primary start action without saved progress", () => {
		const page = render({ readiness: { ...readiness, round: null } });
		expect(page.button("challenge.continue")).toBeUndefined();
		expect(page.button("challenge.start")?.variant).toBe("primary");
	});

	it.each([{ isStarting: true }, { readiness: { ...readiness, eligibleCount: 0 } }])(
		"disables start and resume while starting or without eligible cards",
		(props) => {
			const page = render(props);
			expect(page.button("challenge.continue")?.disabled).toBe(true);
			expect(page.button("challenge.restart")?.disabled).toBe(true);
		},
	);
});
