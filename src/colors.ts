/**
 * Theme colors behind the palette classes gantt-color-0 … 7, in slot order
 * (keep in sync with styles/gantt-overrides.css).
 */
export const PALETTE_VARS = [
	'--color-blue', '--color-green', '--color-orange', '--color-red',
	'--color-purple', '--color-yellow', '--color-cyan', '--color-pink',
];

/** Bars are drawn at a fixed lightness, so two colors look alike when their hues are this close. */
const SAME_HUE_DEGREES = 30;

/** Below this saturation a color is grey-ish and has no meaningful hue. */
const MIN_SATURATION = 0.15;

/** Hue (degrees) and saturation (0–1) of any CSS color, resolved against the current theme. */
function hueOf(probe: HTMLElement, cssColor: string): { hue: number; saturation: number } | null {
	probe.style.color = '';
	probe.style.color = cssColor;
	if (!probe.style.color) return null;
	const match = getComputedStyle(probe).color.match(/[\d.]+/g);
	if (!match || match.length < 3) return null;
	const [r, g, b] = match.slice(0, 3).map((v) => Number(v) / 255);
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const delta = max - min;
	const lightness = (max + min) / 2;
	const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
	let hue = 0;
	if (delta > 0) {
		if (max === r) hue = ((g - b) / delta) % 6;
		else if (max === g) hue = (b - r) / delta + 2;
		else hue = (r - g) / delta + 4;
	}
	return { hue: (hue * 60 + 360) % 360, saturation };
}

/**
 * Palette slots whose hue is close to one of `colors` (the colors fixed for
 * specific values), so automatically colored bars don't look like them.
 */
export function slotsResembling(colors: string[]): Set<number> {
	const blocked = new Set<number>();
	if (colors.length === 0) return blocked;
	const probe = document.body.createDiv();
	probe.style.display = 'none';
	try {
		const fixed = colors
			.map((c) => hueOf(probe, c))
			.filter((h): h is { hue: number; saturation: number } => h != null && h.saturation >= MIN_SATURATION);
		PALETTE_VARS.forEach((variable, slot) => {
			const own = hueOf(probe, `var(${variable})`);
			if (!own) return;
			const close = fixed.some((f) => {
				const diff = Math.abs(f.hue - own.hue);
				return Math.min(diff, 360 - diff) <= SAME_HUE_DEGREES;
			});
			if (close) blocked.add(slot);
		});
	} finally {
		probe.remove();
	}
	return blocked;
}

/**
 * Bars are drawn with every hue at the same lightness and a minimum chroma,
 * so the palette looks equally vivid in any theme and white labels stay
 * readable (yellow included); progress is a step deeper, hover a step lighter.
 */
const SHADES = {
	fill: 'oklch(from {c} 0.66 max(c, 0.16) h)',
	progress: 'oklch(from {c} 0.56 max(c, 0.16) h)',
	hover: 'oklch(from {c} 0.7 max(c, 0.17) h)',
};

export type BarShades = Record<keyof typeof SHADES, string>;

/**
 * The bar shades of a CSS color, resolved to plain color values once per
 * color and theme, rather than by CSS on every bar of every render (each
 * frame while zooming). Without relative color support the color itself is
 * used.
 */
export function barShades(probe: HTMLElement, cssColor: string): BarShades {
	// With var() in it, an unsupported expression would still be accepted
	// and only fail when computed, so check support up front.
	const supported = CSS.supports('color', 'oklch(from red l c h)');
	const resolve = (expression: string): string => {
		if (!supported) return cssColor;
		probe.style.color = expression;
		return getComputedStyle(probe).color;
	};
	return {
		fill: resolve(SHADES.fill.replace('{c}', cssColor)),
		progress: resolve(SHADES.progress.replace('{c}', cssColor)),
		hover: resolve(SHADES.hover.replace('{c}', cssColor)),
	};
}

/** Set a bar's shades as the CSS variables the bar styles read. */
export function setBarShades(el: HTMLElement | SVGElement, shades: BarShades, prefix = '--gantt'): void {
	el.style.setProperty(`${prefix}-fill`, shades.fill);
	el.style.setProperty(`${prefix}-progress`, shades.progress);
	el.style.setProperty(`${prefix}-hover`, shades.hover);
}
