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
	ChevronRight,
	ChevronUp,
	CirclePlay,
	FastForward,
	FolderPlus,
	GripVertical,
	Maximize2,
	Minimize2,
	Pause,
	Play,
	Rewind,
	Settings,
	SkipBack,
	SkipForward,
	Trash2,
	X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FlashcardButton } from "../../../core/ui/primitives/Button";
import { FlashcardHeader } from "../../../core/ui/primitives/Header";
import { cls } from "../../../core/shared/classNames";
import type { Language } from "../../../core/shared/types";
import type { FloatingRect, LocalVideoSource, VideoPlayerSnapshot } from "../domain/types";
import { VIDEO_PLAYBACK_RATES } from "../domain/types";
import type { VideoPlayerRuntime } from "../domain/videoPlayerRuntime";
import { matchesKeyboardShortcut } from "../settings/keyboardShortcut";
import type { VideoPlayerSettings } from "../settings/slice";
import { videoPlayerStrings } from "../strings/videoPlayer";
import styles from "./VideoPlayer.module.scss";
import type { PlayerFocusController } from "./playerFocusController";
import type { VideoPlayerPresenterLease } from "./presenterLease";

/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions -- The player is a composite keyboard surface. */
/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- The composite player must be tabbable. */

export interface VideoPlayerViewProps {
	runtime: VideoPlayerRuntime;
	language: Language;
	rootEl: HTMLElement;
	presenterLease: VideoPlayerPresenterLease;
	focusController: PlayerFocusController;
	settings: VideoPlayerSettings;
	onFocusExisting: () => void;
	onOpenSettings: () => void;
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
	focusController,
	settings,
	onFocusExisting,
	onOpenSettings,
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
		element.tabIndex = -1;
		return element;
	});
	const hostElementRef = useRef<HTMLDivElement | null>(null);
	const attachMediaHost = useCallback(
		(node: HTMLDivElement | null) => {
			hostElementRef.current = node;
			if (node && media.parentElement !== node) {
				node.append(media);
			}
		},
		[media],
	);
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
		const host = hostElementRef.current;
		if (host && media.parentElement !== host) host.append(media);
	});

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
	const renderPlayer = (onToggleMaximize?: () => void) => (
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
			mediaHostRef={attachMediaHost}
			playing={snapshot.playing}
			rate={snapshot.playbackRate}
			settings={settings}
			focusController={focusController}
			canPrevious={currentIndex > 0}
			canNext={currentIndex >= 0 && currentIndex < snapshot.sources.length - 1}
			onToggle={() => runtime.togglePlayback()}
			onPrevious={() => runtime.previous()}
			onNext={() => runtime.next()}
			onBackward={() => runtime.seekBy(-settings.skipInterval)}
			onForward={() => runtime.seekBy(settings.skipInterval)}
			onSeek={(time) => runtime.seekTo(time)}
			onRate={(rate) => runtime.setPlaybackRate(rate)}
			onFloat={() => {
				focusController.requestFocusAfterRemount();
				runtime.setFloating(true);
			}}
			onToggleMaximize={onToggleMaximize}
			t={t}
		/>
	);

	return (
		<div className={cls("fc-page fc-page--fill", styles.page)}>
			<FlashcardHeader
				icon={CirclePlay}
				title={t.title}
				badge={snapshot.sources.length > 0 ? snapshot.sources.length : undefined}
				right={
					<div className="flashcard-header-actions">
						<FlashcardButton
							preset="icon"
							icon={Settings}
							title={t.settings}
							aria-label={t.settings}
							onClick={onOpenSettings}
						/>
						<FlashcardButton
							icon={FolderPlus}
							preset="icon"
							title={t.addVideos}
							aria-label={t.addVideos}
							onClick={() => void addVideos()}
						/>
					</div>
				}
			/>

			<div className={cls("fc-page__body", styles.pageBody)}>
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
											focusController.requestFocusAfterRemount();
											runtime.pause();
											runtime.setFloating(false);
										}}
									>
										{t.dockAndPause}
									</FlashcardButton>
								</div>
							) : (
								renderPlayer()
							)}
						</section>
						<aside className={styles.queue} aria-label={t.queue}>
							<div className={styles.queueHeader}>
								<button
									type="button"
									className={styles.queueHeading}
									aria-expanded={snapshot.queueExpanded}
									title={snapshot.queueExpanded ? t.queueCollapse : t.queueExpand}
									onClick={() =>
										runtime.setQueueExpanded(!snapshot.queueExpanded)
									}
								>
									<span className={styles.queueChevron}>
										{snapshot.queueExpanded ? (
											<ChevronDown size={16} />
										) : (
											<ChevronRight size={16} />
										)}
									</span>
									<span className={styles.queueSummaryText}>
										{t.queueSummary(snapshot.sources.length, currentIndex + 1)}
									</span>
								</button>
								<div className={styles.queueHeaderActions}>
									<button
										type="button"
										className={styles.queueAddBtn}
										onClick={(event) => {
											event.stopPropagation();
											void addVideos();
										}}
										title={t.addVideos}
									>
										<FolderPlus size={14} aria-hidden="true" />
										<span>{t.addVideos}</span>
									</button>
								</div>
							</div>
							{snapshot.queueExpanded && (
								<div className={styles.queueList}>
									{snapshot.sources.map((source, index) => {
										const isActive = source.id === snapshot.currentSourceId;
										const progressLabel = sourceProgressLabel(
											source.id,
											snapshot,
											t,
										);
										return (
											<div
												key={source.id}
												className={`${styles.queueItem} ${isActive ? styles.active : ""}`}
												onDragOver={(event) => event.preventDefault()}
												onDrop={() => {
													const dragged = draggedId.current;
													if (!dragged || dragged === source.id) return;
													const ids = snapshot.sources.map(
														(item) => item.id,
													);
													const from = ids.indexOf(dragged);
													const to = ids.indexOf(source.id);
													if (from < 0 || to < 0) return;
													ids.splice(to, 0, ...ids.splice(from, 1));
													runtime.reorderSources(ids);
												}}
											>
												<div
													className={styles.dragHandle}
													draggable
													aria-label={t.dragToReorder}
													title={t.dragToReorder}
													onDragStart={() => {
														draggedId.current = source.id;
													}}
												>
													<GripVertical size={14} aria-hidden="true" />
												</div>
												<div
													className={styles.sourceIndex}
													aria-hidden="true"
												>
													{isActive ? (
														<Play
															size={11}
															className={styles.activePlayIcon}
														/>
													) : (
														<span>{index + 1}</span>
													)}
												</div>
												<div
													role="button"
													tabIndex={0}
													className={styles.sourceContent}
													onClick={() => runtime.selectSource(source.id)}
													onKeyDown={(event) => {
														if (
															event.key === "Enter" ||
															event.key === " "
														) {
															event.preventDefault();
															runtime.selectSource(source.id);
														}
													}}
													title={source.path}
												>
													<div className={styles.sourceName}>
														{source.name}
													</div>
													{progressLabel && (
														<div className={styles.sourceMeta}>
															<span
																className={
																	isActive
																		? styles.playingTag
																		: styles.progressTag
																}
															>
																{progressLabel}
															</span>
														</div>
													)}
												</div>
												<div className={styles.itemActions}>
													{snapshot.sources.length > 1 && (
														<>
															<IconButton
																icon={ChevronUp}
																size={14}
																className={styles.actionBtn}
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
																size={14}
																className={styles.actionBtn}
																label={t.moveDown}
																disabled={
																	index ===
																	snapshot.sources.length - 1
																}
																onClick={() =>
																	moveSource(
																		runtime,
																		snapshot.sources,
																		index,
																		index + 1,
																	)
																}
															/>
														</>
													)}
													<IconButton
														icon={FolderPlus}
														size={14}
														className={styles.actionBtn}
														label={t.replace}
														onClick={async () => {
															const replacement =
																await onPickReplacement(source.id);
															if (replacement) {
																runtime.replaceSource(
																	source.id,
																	replacement,
																);
															}
														}}
													/>
													<IconButton
														icon={Trash2}
														size={14}
														className={`${styles.actionBtn} ${styles.deleteBtn}`}
														label={t.remove}
														onClick={() =>
															runtime.removeSource(source.id)
														}
													/>
												</div>
											</div>
										);
									})}
								</div>
							)}
						</aside>
					</div>
				)}
			</div>

			{snapshot.floating &&
				createPortal(
					<FloatingPlayer
						document={document}
						initialRect={snapshot.floatingRect}
						onRectChange={(rect) => runtime.setFloatingRect(rect)}
						onClose={() => {
							focusController.requestFocusAfterRemount();
							runtime.pause();
							runtime.setFloating(false);
						}}
						title={t.title}
						closeLabel={t.dockAndPause}
						maximizeLabel={t.maximize}
						restoreLabel={t.restore}
						resizeLeftLabel={t.resizeLeft}
						resizeRightLabel={t.resizeRight}
					>
						{({ toggleMaximize }) => renderPlayer(toggleMaximize)}
					</FloatingPlayer>,
					document.body,
				)}
		</div>
	);
}

type PlayerCopy = ReturnType<typeof videoPlayerStrings>;

function PlayerSurface({
	currentTime,
	duration,
	error,
	floating,
	mediaHostRef,
	playing,
	rate,
	settings,
	focusController,
	canPrevious,
	canNext,
	onToggle,
	onPrevious,
	onNext,
	onBackward,
	onForward,
	onSeek,
	onRate,
	onFloat,
	onToggleMaximize,
	t,
}: {
	currentTime: number;
	duration: number | null;
	error: string | null;
	floating: boolean;
	mediaHostRef: (node: HTMLDivElement | null) => void;
	playing: boolean;
	rate: number;
	settings: VideoPlayerSettings;
	focusController: PlayerFocusController;
	canPrevious: boolean;
	canNext: boolean;
	onToggle: () => void;
	onPrevious: () => void;
	onNext: () => void;
	onBackward: () => void;
	onForward: () => void;
	onSeek: (time: number) => void;
	onRate: (rate: (typeof VIDEO_PLAYBACK_RATES)[number]) => void;
	onFloat: () => void;
	onToggleMaximize?: () => void;
	t: PlayerCopy;
}): React.ReactNode {
	const surfaceRef = useRef<HTMLDivElement>(null);
	useEffect(
		() =>
			focusController.register(() => {
				const element = surfaceRef.current;
				const win = element?.ownerDocument.defaultView;
				if (!element) return;
				if (win?.requestAnimationFrame) win.requestAnimationFrame(() => element.focus());
				else element.focus();
			}),
		[focusController],
	);

	const handleShortcut = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (isInteractiveTarget(event.target)) return;
		const action = matchesKeyboardShortcut(event, settings.shortcuts.togglePlayback)
			? onToggle
			: matchesKeyboardShortcut(event, settings.shortcuts.seekBackward)
				? onBackward
				: matchesKeyboardShortcut(event, settings.shortcuts.seekForward)
					? onForward
					: null;
		if (!action) return;
		event.preventDefault();
		event.stopPropagation();
		if (!event.repeat) action();
	};

	return (
		<div
			ref={surfaceRef}
			className={styles.surface}
			tabIndex={0}
			role="application"
			aria-label={t.playerRegion}
			onKeyDown={handleShortcut}
			onPointerDown={(event) => {
				if (!isInteractiveTarget(event.target)) surfaceRef.current?.focus();
			}}
		>
			<div
				ref={mediaHostRef}
				className={styles.mediaHost}
				onDoubleClick={(event) => {
					if (onToggleMaximize && !isInteractiveTarget(event.target)) {
						event.preventDefault();
						onToggleMaximize();
					}
				}}
			/>
			{error && <p className={styles.error}>{error}</p>}
			<ProgressSlider
				currentTime={currentTime}
				duration={duration}
				skipInterval={settings.skipInterval}
				label={t.progress}
				onSeek={onSeek}
			/>
			<div className={styles.controls}>
				<IconButton
					icon={SkipBack}
					label={t.previous}
					disabled={!canPrevious}
					onClick={onPrevious}
				/>
				<IconButton
					icon={Rewind}
					label={t.backward(settings.skipInterval)}
					onClick={onBackward}
				/>
				<FlashcardButton
					preset="icon"
					variant="primary"
					icon={playing ? Pause : Play}
					aria-label={playing ? t.pause : t.play}
					title={playing ? t.pause : t.play}
					onClick={onToggle}
				/>
				<IconButton
					icon={FastForward}
					label={t.forward(settings.skipInterval)}
					onClick={onForward}
				/>
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

function ProgressSlider({
	currentTime,
	duration,
	skipInterval,
	label,
	onSeek,
}: {
	currentTime: number;
	duration: number | null;
	skipInterval: number;
	label: string;
	onSeek: (time: number) => void;
}): React.ReactNode {
	const [draft, setDraft] = useState<number | null>(null);
	const draftRef = useRef<number | null>(null);
	const maximum = duration && duration > 0 ? duration : 0;
	const displayed = maximum > 0 ? clamp(draft ?? currentTime, 0, maximum) : 0;
	const updateDraft = (value: number) => {
		const next = clamp(value, 0, maximum);
		draftRef.current = next;
		setDraft(next);
	};
	const commit = () => {
		if (draftRef.current === null) return;
		onSeek(draftRef.current);
		draftRef.current = null;
		setDraft(null);
	};

	return (
		<div className={styles.progressRow}>
			<span>{formatTime(displayed)}</span>
			<input
				type="range"
				className={styles.progress}
				aria-label={label}
				aria-valuetext={`${formatTime(displayed)} / ${formatTime(maximum)}`}
				min={0}
				max={maximum}
				step={1}
				value={displayed}
				disabled={maximum <= 0}
				onChange={(event) => updateDraft(Number(event.target.value))}
				onPointerUp={commit}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
					event.preventDefault();
					event.stopPropagation();
					if (event.repeat) return;
					const direction = event.key === "ArrowLeft" ? -1 : 1;
					updateDraft(displayed + direction * (event.shiftKey ? skipInterval : 1));
				}}
				onKeyUp={(event) => {
					if (event.key === "ArrowLeft" || event.key === "ArrowRight") commit();
				}}
			/>
			<span>{formatTime(maximum)}</span>
		</div>
	);
}

export function FloatingPlayer({
	document,
	initialRect,
	onRectChange,
	onClose,
	title,
	closeLabel,
	maximizeLabel,
	restoreLabel,
	resizeLeftLabel,
	resizeRightLabel,
	children,
}: {
	document: Document;
	initialRect: FloatingRect | null;
	onRectChange: (rect: FloatingRect) => void;
	onClose: () => void;
	title: string;
	closeLabel: string;
	maximizeLabel: string;
	restoreLabel: string;
	resizeLeftLabel: string;
	resizeRightLabel: string;
	children: (context: { isMaximized: boolean; toggleMaximize: () => void }) => React.ReactNode;
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
	const [isMaximized, setIsMaximized] = useState(false);
	const isMaximizedRef = useRef(isMaximized);
	useEffect(() => {
		isMaximizedRef.current = isMaximized;
	}, [isMaximized]);

	const rectRef = useRef(rect);
	useEffect(() => {
		rectRef.current = rect;
	}, [rect]);

	const normalRectRef = useRef(rect);
	if (!isMaximized) {
		normalRectRef.current = rect;
	}

	const toggleMaximize = useCallback(() => {
		setIsMaximized((prev) => {
			if (!prev) {
				normalRectRef.current = rectRef.current;
				return true;
			}
			const restored = clampRect(normalRectRef.current, viewport());
			rectRef.current = restored;
			setRect(restored);
			onRectChange(restored);
			return false;
		});
	}, [onRectChange, viewport]);

	useEffect(() => {
		const win = document.defaultView;
		if (!win) return;
		const onResize = () => {
			const next = clampRect(normalRectRef.current, viewport());
			normalRectRef.current = next;
			if (!isMaximizedRef.current) {
				rectRef.current = next;
				setRect(next);
				onRectChange(next);
			}
		};
		win.addEventListener("resize", onResize);
		return () => win.removeEventListener("resize", onResize);
	}, [document, onRectChange, viewport]);

	const beginPointer = (
		event: React.PointerEvent,
		kind: "move" | "resize-left" | "resize-right",
	) => {
		event.preventDefault();
		const origin = { x: event.clientX, y: event.clientY };
		const win = document.defaultView;
		if (!win) return;

		let start = rectRef.current;
		let moved = false;
		let demotedFromMaximized = false;

		const move = (pointer: PointerEvent) => {
			const rawDx = pointer.clientX - origin.x;
			const rawDy = pointer.clientY - origin.y;
			if (!moved) {
				if (Math.hypot(rawDx, rawDy) < 3) return;
				moved = true;
				if (kind === "move" && isMaximizedRef.current) {
					start = computeDemotedDragStart(origin, normalRectRef.current, viewport());
					demotedFromMaximized = true;
					setIsMaximized(false);
					rectRef.current = start;
					normalRectRef.current = start;
					setRect(start);
				}
			}

			const dx = pointer.clientX - origin.x;
			const dy = pointer.clientY - origin.y;
			const next =
				kind === "resize-left"
					? resizeFromLeft(start, dx, dy, viewport())
					: clampRect(
							kind === "move"
								? { ...start, x: start.x + dx, y: start.y + dy }
								: {
										...start,
										width: start.width + dx,
										height: start.height + dy,
									},
							viewport(),
						);
			rectRef.current = next;
			if (!demotedFromMaximized || !isMaximizedRef.current) {
				normalRectRef.current = next;
			}
			setRect(next);
		};
		const finish = () => {
			win.removeEventListener("pointermove", move);
			win.removeEventListener("pointerup", finish);
			if (moved || demotedFromMaximized) {
				onRectChange(rectRef.current);
			}
		};
		win.addEventListener("pointermove", move);
		win.addEventListener("pointerup", finish, { once: true });
	};

	return (
		<section
			className={cls(styles.floatingPlayer, isMaximized && styles.maximized)}
			tabIndex={-1}
			style={{
				left: isMaximized ? 0 : rect.x,
				top: isMaximized ? 0 : rect.y,
				width: isMaximized ? "100%" : rect.width,
				height: isMaximized ? "100%" : rect.height,
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape" && isMaximized) {
					event.preventDefault();
					event.stopPropagation();
					toggleMaximize();
				}
			}}
		>
			<header
				className={styles.floatingHeader}
				onPointerDown={(event) => {
					if (!isInteractiveTarget(event.target)) beginPointer(event, "move");
				}}
				onDoubleClick={(event) => {
					if (!isInteractiveTarget(event.target)) {
						event.preventDefault();
						toggleMaximize();
					}
				}}
			>
				<strong>{title}</strong>
				<div className={styles.floatingHeaderActions}>
					<IconButton
						icon={isMaximized ? Minimize2 : Maximize2}
						label={isMaximized ? restoreLabel : maximizeLabel}
						onClick={toggleMaximize}
					/>
					<IconButton icon={X} label={closeLabel} onClick={onClose} />
				</div>
			</header>
			<div className={styles.floatingBody}>{children({ isMaximized, toggleMaximize })}</div>
			{!isMaximized && (
				<>
					<button
						type="button"
						className={`${styles.resizeHandle} ${styles.resizeLeft}`}
						aria-label={resizeLeftLabel}
						onPointerDown={(event) => beginPointer(event, "resize-left")}
					/>
					<button
						type="button"
						className={`${styles.resizeHandle} ${styles.resizeRight}`}
						aria-label={resizeRightLabel}
						onPointerDown={(event) => beginPointer(event, "resize-right")}
					/>
				</>
			)}
		</section>
	);
}

function IconButton({
	icon,
	label,
	disabled,
	onClick,
	className,
	size = 16,
}: {
	icon: LucideIcon;
	label: string;
	disabled?: boolean;
	onClick: () => void | Promise<void>;
	className?: string;
	size?: number;
}): React.ReactNode {
	return (
		<FlashcardButton
			preset="icon"
			variant="ghost"
			icon={icon}
			iconSize={size}
			aria-label={label}
			title={label}
			disabled={disabled}
			className={className}
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

function sourceProgressLabel(
	sourceId: string,
	snapshot: VideoPlayerSnapshot,
	t: PlayerCopy,
): string {
	if (sourceId === snapshot.currentSourceId && snapshot.duration) {
		return `${formatTime(snapshot.currentTime)} / ${formatTime(snapshot.duration)}`;
	}
	if (snapshot.completedSourceIds.includes(sourceId)) return t.completed;
	const progress = snapshot.progressBySource[sourceId] ?? 0;
	return progress > 0 ? t.watched(formatTime(progress)) : "";
}

function isInteractiveTarget(target: EventTarget): boolean {
	return Boolean(
		(target as Element | null)?.closest?.(
			"button, input, select, textarea, summary, a, [contenteditable='true']",
		),
	);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
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

export function clampRect(
	rect: FloatingRect,
	viewport: { width: number; height: number },
): FloatingRect {
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

export function resizeFromLeft(
	start: FloatingRect,
	dx: number,
	dy: number,
	viewport: { width: number; height: number },
): FloatingRect {
	const right = start.x + start.width;
	const maxWidth = Math.max(1, right - EDGE_GAP);
	const minWidth = Math.min(MIN_WIDTH, maxWidth);
	const width = clamp(start.width - dx, minWidth, maxWidth);
	return clampRect({ x: right - width, y: start.y, width, height: start.height + dy }, viewport);
}

export function computeDemotedDragStart(
	origin: { x: number; y: number },
	normal: FloatingRect,
	viewport: { width: number; height: number },
): FloatingRect {
	const clampedNormal = clampRect(normal, viewport);
	const ratioX = viewport.width > 0 ? origin.x / viewport.width : 0.5;
	const targetX = clamp(
		origin.x - ratioX * clampedNormal.width,
		EDGE_GAP,
		Math.max(EDGE_GAP, viewport.width - clampedNormal.width - EDGE_GAP),
	);
	const targetY = clamp(
		origin.y - 18,
		EDGE_GAP,
		Math.max(EDGE_GAP, viewport.height - clampedNormal.height - EDGE_GAP),
	);
	return {
		x: targetX,
		y: targetY,
		width: clampedNormal.width,
		height: clampedNormal.height,
	};
}
