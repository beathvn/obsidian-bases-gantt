import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// A fixed time zone with daylight saving time, so date math is tested
// the same way on every machine, DST switches included.
process.env.TZ = 'Europe/Vienna';

export default defineConfig({
	// The plugin's CSS overrides as text, for tests that check what the stylesheet declares.
	define: {
		__OVERRIDES_CSS__: JSON.stringify(readFileSync('src/styles/gantt-overrides.css', 'utf8')),
	},
	resolve: {
		// The obsidian package only ships types; tests run against a small stand-in.
		alias: { obsidian: fileURLToPath(new URL('./tests/support/obsidian.ts', import.meta.url)) },
	},
	test: {
		environment: 'jsdom',
		include: ['tests/**/*.test.ts'],
	},
});
