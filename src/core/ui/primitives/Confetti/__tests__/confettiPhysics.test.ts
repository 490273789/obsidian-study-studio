import { describe, expect, it, vi } from "vitest";
import {
	createCannonBurst,
	DEFAULT_CONFETTI_COLORS,
	renderConfettiParticle,
	updateConfettiParticle,
	type ConfettiParticle,
} from "../confettiPhysics";

describe("confetti physics", () => {
	it("creates particles with valid initial parameters and bounds", () => {
		const origin = { x: 0, y: 300 };
		const particles = createCannonBurst({
			origin,
			angleDeg: 60,
			spreadDeg: 40,
			count: 20,
			minSpeed: 10,
			maxSpeed: 20,
		});

		expect(particles).toHaveLength(20);
		for (const p of particles) {
			expect(p.x).toBe(origin.x);
			expect(p.y).toBe(origin.y);
			expect(p.alpha).toBe(1);
			expect(p.age).toBe(0);
			expect(p.maxAge).toBeGreaterThan(100);
			expect(DEFAULT_CONFETTI_COLORS).toContain(p.color);
			// For angle ~60 deg, vx > 0 and vy < 0 (pointing upwards in canvas coordinates)
			expect(p.vx).toBeGreaterThan(0);
			expect(p.vy).toBeLessThan(0);
		}
	});

	it("updates particle position, applies gravity and drag, and retires when expired", () => {
		const particle: ConfettiParticle = {
			x: 100,
			y: 100,
			vx: 10,
			vy: -15,
			width: 8,
			height: 14,
			color: "#FFD700",
			alpha: 1,
			rotation: 0,
			rotationSpeed: 0.05,
			wobble: 0,
			wobbleSpeed: 0.1,
			age: 0,
			maxAge: 50,
		};

		const isAlive = updateConfettiParticle(particle);
		expect(isAlive).toBe(true);
		expect(particle.age).toBe(1);
		expect(particle.x).not.toBe(100);
		expect(particle.y).toBeLessThan(100); // initial vy was -15, so y decreased (moved up)

		// Fast-forward near end of life
		particle.age = 45;
		const stillAlive = updateConfettiParticle(particle);
		expect(stillAlive).toBe(true);
		expect(particle.alpha).toBeLessThan(1); // fading out

		// Fast-forward past maxAge
		particle.age = 50;
		const expired = updateConfettiParticle(particle);
		expect(expired).toBe(false);
	});

	it("renders particle to canvas context safely", () => {
		const particle: ConfettiParticle = {
			x: 50,
			y: 50,
			vx: 0,
			vy: 0,
			width: 6,
			height: 12,
			color: "#3B82F6",
			alpha: 0.8,
			rotation: 0.5,
			rotationSpeed: 0.01,
			wobble: 1.2,
			wobbleSpeed: 0.1,
			age: 10,
			maxAge: 100,
		};

		const mockCtx = {
			save: vi.fn(),
			translate: vi.fn(),
			rotate: vi.fn(),
			scale: vi.fn(),
			fillStyle: "",
			globalAlpha: 1,
			fillRect: vi.fn(),
			restore: vi.fn(),
		};

		renderConfettiParticle(mockCtx as unknown as CanvasRenderingContext2D, particle);

		expect(mockCtx.save).toHaveBeenCalled();
		expect(mockCtx.translate).toHaveBeenCalledWith(50, 50);
		expect(mockCtx.rotate).toHaveBeenCalledWith(0.5);
		expect(mockCtx.fillRect).toHaveBeenCalledWith(-3, -6, 6, 12);
		expect(mockCtx.restore).toHaveBeenCalled();
	});
});
