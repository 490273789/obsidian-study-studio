import type { CardMotion } from "../../answerPresentationTransition";
import type { CSSProperties, ReactNode, Ref } from "react";
import { cls } from "../../../../../core/shared/classNames";
import styles from "./SessionLayout.module.scss";

interface SessionLayoutProps {
	rootRef?: Ref<HTMLDivElement>;
	header: ReactNode;
	children: ReactNode;
	footer: ReactNode;
	className?: string;
	busy: boolean;
	motion?: CardMotion;
}

/** Presentation only: the mounted view retains shortcuts, inputs and transactions. */
export function SessionLayout({
	rootRef,
	header,
	children,
	footer,
	className,
	busy,
	motion,
}: SessionLayoutProps) {
	return (
		<div
			ref={rootRef}
			className={cls("flashcard-study fc-page fc-page--fill", styles.page, className)}
		>
			{header}
			<div
				className={cls("flashcard-content", styles.content)}
				aria-busy={busy}
				data-card-transition={motion ? "leaving" : "idle"}
				style={
					motion
						? ({
								"--fc-card-exit-duration": `${motion.durationMs}ms`,
								"--fc-card-exit-offset":
									motion.direction === "backward" ? "6px" : "-6px",
							} as CSSProperties)
						: undefined
				}
			>
				{children}
			</div>
			<footer className={cls("flashcard-footer", styles.footer)}>{footer}</footer>
		</div>
	);
}
