import React, {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import {
	ChevronDown,
	ChevronUp,
	FastForward,
	FolderPlus,
	Minimize2,
	Pause,
	Play,
	Rewind,
	SkipBack,
	SkipForward,
	Trash2,
	X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FlashcardButton } from "../../../core/ui/primitives/Button";
import type { Language } from "../../../core/shared/types";
import type { FloatingRect, LocalVideoSource } from "../domain/types";
import { VIDEO_PLAYBACK_RATES } from "../domain/types";
import type { VideoPlayerRuntime } from "../domain/videoPlayerRuntime";
import { videoPlayerStrings } from "../strings/videoPlayer";
import styles from "./VideoPlayer.module.scss";
import type { VideoPlayerPresenterLease } from "./presenterLease";

export interface VideoPlayerViewProps {
	runtime: VideoPlayerRuntime;
	language: Language;
	rootEl: HTMLElement;
	presenterLease: VideoPlayerPresenterLease;
	onFocusExisting: () => void;
	onPickVideos: () => Promise<readonly LocalVideoSource[]>;
	onPickReplacement: (sourceId: string) => Promise<LocalVideoSource | null>;
}

const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;
const EDGE_GAP = 16;

export function VideoPlayerView({
	runtime,
	language,
	rootEl,
	presenterLease,
	onFocusExisting,
	onPickVideos,
	onPickReplacement,
}: VideoPlayerViewProps): React.ReactNode {
	const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
	const presenter = useSyncExternalStore(presenterLease.subscribe, presenterLease.getSnapshot);
	const [presenterToken] = useState(() => Symbol("video-player-view"));
	const t = videoPlayerStrings(language);
	const document = rootEl.ownerDocument;
	const [media] = useState(() => {
		const element = document.createElement("video");
		element.className = styles.video;
		element.playsInline = true;
		element.preload = "metadata";
		return element;
	});
	const dockedHost = useRef<HTMLDivElement>(null);
	const floatingHost = useRef<HTMLDivElement>(null);
	const draggedId = useRef<string | null>(null);
	const activePresenter = presenter === presenterToken;

	useEffect(() => {
		presenterLease.acquire(presenterToken);
		return () => presenterLease.release(presenterToken);
	}, [presenterLease, presenterToken]);

	useEffect(() => {
		if (presenter === null) presenterLease.acquire(presenterToken);
	}, [presenter, presenterLease, presenterToken]);

	useEffect(() => {
		if (!activePresenter) return;
		const release = runtime.bindMedia(media);
		return () => {
			runtime.pause();
			runtime.setFloating(false);
			release();
			media.pause();
			media.remove();
		};
	}, [activePresenter, media, runtime]);

	useLayoutEffect(() => {
		const host = snapshot.floating ? floatingHost.current : dockedHost.current;
		if (host && media.parentElement !== host) host.append(media);
	}, [media, snapshot.floating]);

	const addVideos = useCallback(async () => {
		const sources = await onPickVideos();
		runtime.addSources(sources);
	}, [onPickVideos, runtime]);

	const currentIndex = snapshot.sources.findIndex(
		(source) => source.id === snapshot.currentSourceId,
	);
	if (!activePresenter) {
		return (
			<div className={styles.empty}>
				<h3>{t.activeElsewhere}</h3>
				<FlashcardButton variant="primary" onClick={onFocusExisting}>
					{t.focusPlayer}
				</FlashcardButton>
			</div>
		);
	}
	const player = (
		<PlayerSurface
			currentTime={snapshot.currentTime}
			duration={snapshot.duration}
			error={
				snapshot.error === "playback"
					? t.decodeError
					: snapshot.error === "media"
						? t.decodeError
						: null
			}
			floating={snapshot.floating}
			floatingHost={floatingHost}
			dockedHost={dockedHost}
			playing={snapshot.playing}
			rate={snapshot.playbackRate}
			canPrevious={currentIndex > 0}
			canNext={currentIndex >= 0 && currentIndex < snapshot.sources.length - 1}
			onToggle={() => runtime.togglePlayback()}
			onPrevious={() => runtime.previous()}
			onNext={() => runtime.next()}
			onBackward={() => runtime.seekBy(-10)}
			onForward={() => runtime.seekBy(10)}
			onRate={(rate) => runtime.setPlaybackRate(rate)}
			onFloat={() => runtime.setFloating(true)}
			t={t}
		/>
	);

	return (
		<div className={styles.page}>
			<header className={styles.header}>
				<div>
					<p className="fc-kicker">Study Studio</p>
					<h2>{t.title}</h2>
				</div>
				<FlashcardButton
					variant="primary"
					icon={FolderPlus}
					onClick={() => void addVideos()}
				>
					{t.addVideos}
				</FlashcardButton>
			</header>

			{snapshot.sources.length === 0 ? (
				<div className={styles.empty}>
					<h3>{t.emptyTitle}</h3>
					<p>{t.emptyDescription}</p>
					<FlashcardButton
						variant="primary"
						icon={FolderPlus}
						onClick={() => void addVideos()}
					>
						{t.addVideos}
					</FlashcardButton>
				</div>
			) : (
				<div className={styles.layout}>
					<section className={styles.playerPanel}>
						{snapshot.floating ? (
							<div className={styles.floatingPlaceholder}>
								<p>{t.floating}</p>
								<FlashcardButton
									variant="secondary"
									onClick={() => {
										runtime.pause();
										runtime.setFloating(false);
									}}
								>
									{t.dockAndPause}
								</FlashcardButton>
							</div>
						) : (
							player
						)}
					</section>
					<aside className={styles.queue} aria-label={t.queue}>
						<div className={styles.queueHeading}>
							<h3>{t.queue}</h3>
							<span>{snapshot.sources.length}</span>
						</div>
						<div className={styles.queueList}>
							{snapshot.sources.map((source, index) => (
								<div
									key={source.id}
									className={`${styles.queueItem} ${source.id === snapshot.currentSourceId ? styles.active : ""}`}
									draggable
									onDragStart={() => {
										draggedId.current = source.id;
									}}
									onDragOver={(event) => event.preventDefault()}
									onDrop={() => {
										const dragged = draggedId.current;
										if (!dragged || dragged === source.id) return;
										const ids = snapshot.sources.map((item) => item.id);
										const from = ids.indexOf(dragged);
										const to = ids.indexOf(source.id);
										if (from < 0 || to < 0) return;
										ids.splice(to, 0, ...ids.splice(from, 1));
										runtime.reorderSources(ids);
									}}
								>
									<button
										type="button"
										className={styles.sourceButton}
										onClick={() => runtime.selectSource(source.id)}
										title={source.path}
									>
										<span className={styles.sourceIndex}>{index + 1}</span>
										<span className={styles.sourceName}>{source.name}</span>
										{snapshot.completedSourceIds.includes(source.id) && (
											<span className={styles.completed}>{t.completed}</span>
										)}
									</button>
									<div className={styles.itemActions}>
										<IconButton
											icon={ChevronUp}
											label={t.moveUp}
											disabled={index === 0}
											onClick={() =>
												moveSource(
													runtime,
													snapshot.sources,
													index,
													index - 1,
												)
											}
										/>
										<IconButton
											icon={ChevronDown}
											label={t.moveDown}
											disabled={index === snapshot.sources.length - 1}
											onClick={() =>
												moveSource(
													runtime,
													snapshot.sources,
													index,
													index + 1,
												)
											}
										/>
										<IconButton
											icon={FolderPlus}
											label={t.replace}
											onClick={async () => {
												const replacement = await onPickReplacement(
													source.id,
												);
												if (replacement)
													runtime.replaceSource(source.id, replacement);
											}}
										/>
										<IconButton
											icon={Trash2}
											label={t.remove}
											onClick={() => runtime.removeSource(source.id)}
										/>
									</div>
								</div>
							))}
						</div>
					</aside>
				</div>
			)}

			{snapshot.floating &&
				createPortal(
					<FloatingPlayer
						document={document}
						initialRect={snapshot.floatingRect}
						onRectChange={(rect) => runtime.setFloatingRect(rect)}
						onClose={() => {
							runtime.pause();
							runtime.setFloating(false);
						}}
						title={t.title}
					>
						{player}
					</FloatingPlayer>,
					document.body,
				)}
		</div>
	);
}

interface PlayerCopy {
	play: string;
	pause: string;
	previous: string;
	next: string;
	backward: string;
	forward: string;
	floating: string;
	rate: string;
}

function PlayerSurface({
	currentTime,
	duration,
	error,
	floating,
	floatingHost,
	dockedHost,
	playing,
	rate,
	canPrevious,
	canNext,
	onToggle,
	onPrevious,
	onNext,
	onBackward,
	onForward,
	onRate,
	onFloat,
	t,
}: {
	currentTime: number;
	duration: number | null;
	error: string | null;
	floating: boolean;
	floatingHost: React.RefObject<HTMLDivElement | null>;
	dockedHost: React.RefObject<HTMLDivElement | null>;
	playing: boolean;
	rate: number;
	canPrevious: boolean;
	canNext: boolean;
	onToggle: () => void;
	onPrevious: () => void;
	onNext: () => void;
	onBackward: () => void;
	onForward: () => void;
	onRate: (rate: (typeof VIDEO_PLAYBACK_RATES)[number]) => void;
	onFloat: () => void;
	t: PlayerCopy;
}): React.ReactNode {
	return (
		<div className={styles.surface}>
			<div ref={floating ? floatingHost : dockedHost} className={styles.mediaHost} />
			{error && <p className={styles.error}>{error}</p>}
			<div className={styles.timeRow}>
				<span>{formatTime(currentTime)}</span>
				<span>{formatTime(duration ?? 0)}</span>
			</div>
			<div className={styles.controls}>
				<IconButton
					icon={SkipBack}
					label={t.previous}
					disabled={!canPrevious}
					onClick={onPrevious}
				/>
				<IconButton icon={Rewind} label={t.backward} onClick={onBackward} />
				<FlashcardButton
					preset="icon"
					variant="primary"
					icon={playing ? Pause : Play}
					aria-label={playing ? t.pause : t.play}
					title={playing ? t.pause : t.play}
					onClick={onToggle}
				/>
				<IconButton icon={FastForward} label={t.forward} onClick={onForward} />
				<IconButton
					icon={SkipForward}
					label={t.next}
					disabled={!canNext}
					onClick={onNext}
				/>
				<label className={styles.rateControl}>
					<span>{t.rate}</span>
					<select
						value={String(rate)}
						onChange={(event) =>
							onRate(
								Number(event.target.value) as (typeof VIDEO_PLAYBACK_RATES)[number],
							)
						}
					>
						{VIDEO_PLAYBACK_RATES.map((value) => (
							<option key={value} value={value}>
								{value}×
							</option>
						))}
					</select>
				</label>
				{!floating && <IconButton icon={Minimize2} label={t.floating} onClick={onFloat} />}
			</div>
		</div>
	);
}

function FloatingPlayer({
	document,
	initialRect,
	onRectChange,
	onClose,
	title,
	children,
}: {
	document: Document;
	initialRect: FloatingRect | null;
	onRectChange: (rect: FloatingRect) => void;
	onClose: () => void;
	title: string;
	children: React.ReactNode;
}): React.ReactNode {
	const viewport = useCallback(
		() => ({
			width: document.defaultView?.innerWidth ?? 1024,
			height: document.defaultView?.innerHeight ?? 768,
		}),
		[document],
	);
	const [rect, setRect] = useState(() =>
		clampRect(initialRect ?? defaultRect(viewport()), viewport()),
	);
	const rectRef = useRef(rect);
	useEffect(() => {
		rectRef.current = rect;
	}, [rect]);

	useEffect(() => {
		const win = document.defaultView;
		if (!win) return;
		const onResize = () => {
			const next = clampRect(rectRef.current, viewport());
			setRect(next);
			onRectChange(next);
		};
		win.addEventListener("resize", onResize);
		return () => win.removeEventListener("resize", onResize);
	}, [document, onRectChange, viewport]);

	const beginPointer = (event: React.PointerEvent, kind: "move" | "resize") => {
		event.preventDefault();
		const start = rectRef.current;
		const origin = { x: event.clientX, y: event.clientY };
		const win = document.defaultView;
		if (!win) return;
		const move = (pointer: PointerEvent) => {
			const dx = pointer.clientX - origin.x;
			const dy = pointer.clientY - origin.y;
			const next = clampRect(
				kind === "move"
					? { ...start, x: start.x + dx, y: start.y + dy }
					: { ...start, width: start.width + dx, height: start.height + dy },
				viewport(),
			);
			rectRef.current = next;
			setRect(next);
		};
		const finish = () => {
			win.removeEventListener("pointermove", move);
			win.removeEventListener("pointerup", finish);
			onRectChange(rectRef.current);
		};
		win.addEventListener("pointermove", move);
		win.addEventListener("pointerup", finish, { once: true });
	};

	return (
		<section
			className={styles.floatingPlayer}
			style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
		>
			<header
				className={styles.floatingHeader}
				onPointerDown={(event) => beginPointer(event, "move")}
			>
				<strong>{title}</strong>
				<IconButton icon={X} label={title} onClick={onClose} />
			</header>
			<div className={styles.floatingBody}>{children}</div>
			<button
				type="button"
				className={styles.resizeHandle}
				aria-label={title}
				onPointerDown={(event) => beginPointer(event, "resize")}
			/>
		</section>
	);
}

function IconButton({
	icon,
	label,
	disabled,
	onClick,
}: {
	icon: LucideIcon;
	label: string;
	disabled?: boolean;
	onClick: () => void | Promise<void>;
}): React.ReactNode {
	return (
		<FlashcardButton
			preset="icon"
			variant="ghost"
			icon={icon}
			aria-label={label}
			title={label}
			disabled={disabled}
			onClick={() => void onClick()}
		/>
	);
}

function moveSource(
	runtime: VideoPlayerRuntime,
	sources: readonly LocalVideoSource[],
	from: number,
	to: number,
): void {
	if (to < 0 || to >= sources.length) return;
	const ids = sources.map((source) => source.id);
	ids.splice(to, 0, ...ids.splice(from, 1));
	runtime.reorderSources(ids);
}

function formatTime(value: number): string {
	if (!Number.isFinite(value) || value < 0) return "0:00";
	const total = Math.floor(value);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = String(total % 60).padStart(2, "0");
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
		: `${minutes}:${seconds}`;
}

function defaultRect(viewport: { width: number; height: number }): FloatingRect {
	const width = Math.min(480, viewport.width - EDGE_GAP * 2);
	const height = Math.min(320, viewport.height - EDGE_GAP * 2);
	return {
		x: viewport.width - width - EDGE_GAP,
		y: viewport.height - height - EDGE_GAP,
		width,
		height,
	};
}

function clampRect(rect: FloatingRect, viewport: { width: number; height: number }): FloatingRect {
	const maxWidth = Math.max(1, viewport.width - EDGE_GAP * 2);
	const maxHeight = Math.max(1, viewport.height - EDGE_GAP * 2);
	const width = Math.min(Math.max(Math.min(MIN_WIDTH, maxWidth), rect.width), maxWidth);
	const height = Math.min(Math.max(Math.min(MIN_HEIGHT, maxHeight), rect.height), maxHeight);
	return {
		x: Math.min(
			Math.max(EDGE_GAP, rect.x),
			Math.max(EDGE_GAP, viewport.width - width - EDGE_GAP),
		),
		y: Math.min(
			Math.max(EDGE_GAP, rect.y),
			Math.max(EDGE_GAP, viewport.height - height - EDGE_GAP),
		),
		width,
		height,
	};
}
