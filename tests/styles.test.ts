import { describe, expect, it } from 'vitest';

/** The plugin's CSS overrides as text, supplied by vitest.config.mts. */
declare const __OVERRIDES_CSS__: string;

/** The declarations of the first rule in the overrides whose selector ends in `selector`. */
function rule(selector: string): string {
	const match = new RegExp(`${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(__OVERRIDES_CSS__);
	return match ? match[1] : '';
}

describe('date header', () => {
	// Frappe makes the header sticky at left: 0. It is as wide as the grid, so that never pins it,
	// unless the scrollable area is wider than the header: the header then stays put for the first
	// few pixels of scrolling and ends up offset from the grid. Only the top pin is wanted.
	it('is not pinned horizontally, so it always scrolls together with the grid', () => {
		expect(rule('.gantt-container .grid-header')).toMatch(/left:\s*auto/);
	});
});
