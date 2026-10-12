import { useLayoutEffect, useRef, useState } from "react";
import {
	bindCardPresentationShortcuts,
	type CardShortcutIntent,
	type CardShortcutState,
} from "../cardPresentationShortcuts";

/** React only supplies the latest presented state and semantic actions. */
export function useCardPresentationShortcuts(
	state: CardShortcutState,
	dispatch: (intent: CardShortcutIntent) => void,
) {
	const [root, setRoot] = useState<HTMLDivElement | null>(null);
	const latest = useRef({ state, dispatch });
	useLayoutEffect(() => {
		latest.current = { state, dispatch };
	}, [state, dispatch]);
	useLayoutEffect(() => {
		if (!root) return;
		return bindCardPresentationShortcuts(
			root,
			() => latest.current.state,
			(intent) => latest.current.dispatch(intent),
		);
	}, [root]);
	return setRoot;
}
