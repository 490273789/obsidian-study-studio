export interface ConfettiParticle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	width: number;
	height: number;
	color: string;
	alpha: number;
	rotation: number;
	rotationSpeed: number;
	wobble: number;
	wobbleSpeed: number;
	age: number;
	maxAge: number;
}

export interface CannonOptions {
	origin: { x: number; y: number };
	angleDeg: number;
	spreadDeg?: number;
	count?: number;
	minSpeed?: number;
	maxSpeed?: number;
	colors?: string[];
}

export const DEFAULT_CONFETTI_COLORS = [
	"#F59E0B", // 琥珀黄
	"#FBBF24", // 明黄
	"#38BDF8", // 天蓝
	"#3B82F6", // 亮蓝
	"#10B981", // 薄荷绿
	"#22C55E", // 翠绿
	"#F97316", // 活力橙
	"#EF4444", // 珊瑚红
	"#EC4899", // 玫粉
	"#A855F7", // 紫色
];

export function createCannonBurst(options: CannonOptions): ConfettiParticle[] {
	const count = options.count ?? 30;
	const spread = options.spreadDeg ?? 50;
	const minSpeed = options.minSpeed ?? 14;
	const maxSpeed = options.maxSpeed ?? 24;
	const colors = options.colors ?? DEFAULT_CONFETTI_COLORS;

	const particles: ConfettiParticle[] = [];

	for (let i = 0; i < count; i++) {
		const angleSpread = (Math.random() - 0.5) * spread;
		const angleDeg = options.angleDeg + angleSpread;
		const rad = (angleDeg * Math.PI) / 180;
		const speed = minSpeed + Math.random() * (maxSpeed - minSpeed);

		const isRibbon = Math.random() > 0.25;
		const width = isRibbon ? 6 + Math.random() * 4 : 5 + Math.random() * 3;
		const height = isRibbon ? 12 + Math.random() * 6 : 5 + Math.random() * 3;

		const color =
			colors[Math.floor(Math.random() * colors.length)] ??
			DEFAULT_CONFETTI_COLORS[0] ??
			"#F59E0B";

		particles.push({
			x: options.origin.x,
			y: options.origin.y,
			vx: Math.cos(rad) * speed,
			vy: -Math.sin(rad) * speed,
			width,
			height,
			color,
			alpha: 1,
			rotation: Math.random() * Math.PI * 2,
			rotationSpeed: (Math.random() - 0.5) * 0.1,
			wobble: Math.random() * Math.PI * 2,
			wobbleSpeed: 0.08 + Math.random() * 0.08,
			age: 0,
			maxAge: 180 + Math.floor(Math.random() * 100),
		});
	}

	return particles;
}

export function updateConfettiParticle(p: ConfettiParticle): boolean {
	p.vx *= 0.96;
	p.vy *= 0.96;
	p.vy += 0.35;
	if (p.vy > 4.8) {
		p.vy = 4.8;
	}
	p.wobble += p.wobbleSpeed;
	p.x += p.vx + Math.sin(p.wobble) * 1.2;
	p.y += p.vy;
	p.rotation += p.rotationSpeed;
	p.age += 1;

	if (p.age >= p.maxAge) {
		return false;
	}

	const fadeStart = p.maxAge - 40;
	if (p.age > fadeStart) {
		p.alpha = Math.max(0, (p.maxAge - p.age) / 40);
	}
	return true;
}

export function renderConfettiParticle(ctx: CanvasRenderingContext2D, p: ConfettiParticle): void {
	ctx.save();
	ctx.translate(p.x, p.y);
	ctx.rotate(p.rotation);
	ctx.scale(Math.cos(p.wobble), 1);
	ctx.fillStyle = p.color;
	ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
	ctx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height);
	ctx.restore();
}
