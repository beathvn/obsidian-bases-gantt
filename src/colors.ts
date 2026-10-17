/**
 * Theme colors behind the palette classes gantt-color-0 … 7, in slot order
 * (keep in sync with styles/gantt-overrides.css).
 */
const PALETTE_VARS = [
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
