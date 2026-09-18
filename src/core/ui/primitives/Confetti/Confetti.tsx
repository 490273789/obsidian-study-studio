import React, { memo, useEffect, useRef } from "react";
import { cls } from "../../../shared/classNames";
import {
	createCannonBurst,
	renderConfettiParticle,
	updateConfettiParticle,
	type ConfettiParticle,
} from "./confettiPhysics";

export interface ConfettiProps {
	className?: string;
	/**
	 * Delays in ms for side cannons bursts.
	 * Default: [0, 200, 450, 750, 1100]
	 */
	burstDelays?: number[];
}

const DEFAULT_BURST_DELAYS = [0, 200, 450, 750, 1100];

export const Confetti = memo(function Confetti({
	className,
	burstDelays = DEFAULT_BURST_DELAYS,
}: ConfettiProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		// Check reduced motion
		if (
			typeof window !== "undefined" &&
			window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
		) {
			return;
		}

		const ctx = canvas.getContext?.("2d");
		if (!ctx) return;

		let animId: number | null = null;
		let timeoutIds: number[] = [];
		let particles: ConfettiParticle[] = [];
		let width = 0;
		let height = 0;
		let dpr = 1;

		const updateCanvasDimensions = () => {
			const rect = canvas.getBoundingClientRect();
			width = rect.width;
			height = rect.height;
			dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);

			canvas.width = Math.max(1, Math.floor(width * dpr));
			canvas.height = Math.max(1, Math.floor(height * dpr));
		};

		updateCanvasDimensions();

		const resizeObserver =
			typeof ResizeObserver !== "undefined"
				? new ResizeObserver(() => {
						updateCanvasDimensions();
					})
				: null;

		if (resizeObserver && canvas.parentElement) {
			resizeObserver.observe(canvas.parentElement);
		}

		let isRunning = false;
		let pendingBursts = burstDelays.length;

		const loop = () => {
			if (!ctx) return;

			ctx.save();
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.clearRect(0, 0, width, height);

			const survivingParticles: ConfettiParticle[] = [];
			for (const p of particles) {
				const alive = updateConfettiParticle(p);
				if (alive && p.y <= height + 80) {
					renderConfettiParticle(ctx, p);
					survivingParticles.push(p);
				}
			}
			particles = survivingParticles;
			ctx.restore();

			if (particles.length > 0 || pendingBursts > 0) {
				animId = requestAnimationFrame(loop);
			} else {
				isRunning = false;
				animId = null;
				ctx.clearRect(0, 0, canvas.width, canvas.height);
			}
		};

		const fireSideCannons = (particleCount = 35) => {
			if (width <= 0 || height <= 0) {
				updateCanvasDimensions();
			}

			// Left cannon: mid-height left corner shooting top-right (55 deg) with wide spread
			const leftParticles = createCannonBurst({
				origin: { x: 0, y: Math.max(20, height * 0.55) },
				angleDeg: 55,
				spreadDeg: 65,
				count: particleCount,
				minSpeed: 16,
				maxSpeed: 32,
			});

			// Right cannon: mid-height right corner shooting top-left (125 deg) with wide spread
			const rightParticles = createCannonBurst({
				origin: { x: width, y: Math.max(20, height * 0.55) },
				angleDeg: 125,
				spreadDeg: 65,
				count: particleCount,
				minSpeed: 16,
				maxSpeed: 32,
			});

			particles.push(...leftParticles, ...rightParticles);

			if (!isRunning) {
				isRunning = true;
				animId = requestAnimationFrame(loop);
			}
		};

		// Schedule side cannon bursts
		timeoutIds = burstDelays.map((delay, index) => {
			return window.setTimeout(() => {
				pendingBursts = Math.max(0, pendingBursts - 1);
				const count = index === 0 ? 45 : 32;
				fireSideCannons(count);
			}, delay);
		});

		return () => {
			if (animId !== null) {
				cancelAnimationFrame(animId);
			}
			for (const tid of timeoutIds) {
				window.clearTimeout(tid);
			}
			if (resizeObserver) {
				resizeObserver.disconnect();
			}
			particles = [];
			if (ctx && canvas) {
				ctx.clearRect(0, 0, canvas.width, canvas.height);
			}
		};
	}, [burstDelays]);

	return <canvas ref={canvasRef} className={cls("fc-confetti", className)} />;
});
