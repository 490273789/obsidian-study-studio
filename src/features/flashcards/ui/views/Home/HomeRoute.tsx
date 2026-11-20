import React, { useCallback, useSyncExternalStore } from "react";
import type {
	DeckHome,
	DeckHomeDestination,
	DeckHomeSnapshot,
} from "../../../domain/decks/deckHome";
import type { WorkbenchFeatureShortcut } from "../../../../../core/host/workbench";
import { DeckList } from "./DeckList";

interface HomeRouteProps {
	home: DeckHome;
	ownerId: string;
	onNavigate: (destination: DeckHomeDestination, deckId: string) => void;
	onRequestMigration: (deckId?: string) => Promise<boolean>;
	onOpenSourceFile: (filePath: string) => void;
	onOpenStats: () => void;
	onOpenSettings: () => void;
	onOpenAddCard: () => void;
	onOpenChallenge?: () => void;
	shortcuts: readonly WorkbenchFeatureShortcut[];
}

/**
 * Subscribes to the deck-home read model only while the landing route is mounted.
 * The home rebuild is deferred while nothing is subscribed, so an active study
 * session no longer pays for a home snapshot on every committed answer.
 */
export const HomeRoute = React.memo(function HomeRoute({ home, ...props }: HomeRouteProps) {
	const subscribe = useCallback((listener: () => void) => home.subscribe(listener), [home]);
	const readSnapshot = useCallback(() => home.getSnapshot(), [home]);
	const snapshot = useSyncExternalStore(subscribe, readSnapshot, readSnapshot);
	return (
		<DeckList
			snapshot={snapshot}
			home={home}
			ownerId={props.ownerId}
			onNavigate={props.onNavigate}
			onRequestMigration={props.onRequestMigration}
			onOpenSourceFile={props.onOpenSourceFile}
			onOpenStats={props.onOpenStats}
			onOpenSettings={props.onOpenSettings}
			onOpenAddCard={props.onOpenAddCard}
			onOpenChallenge={props.onOpenChallenge}
			shortcuts={props.shortcuts}
		/>
	);
});

/**
 * Mounts its children with a live deck-home snapshot. Setup and stats routes use
 * it so those screens keep fresh data without subscribing during a session.
 */
export function DeckHomeSnapshotRoute({
	home,
	children,
}: {
	home: DeckHome;
	children: (snapshot: DeckHomeSnapshot) => React.ReactNode;
}) {
	const subscribe = useCallback((listener: () => void) => home.subscribe(listener), [home]);
	const readSnapshot = useCallback(() => home.getSnapshot(), [home]);
	const snapshot = useSyncExternalStore(subscribe, readSnapshot, readSnapshot);
	return <>{children(snapshot)}</>;
}
