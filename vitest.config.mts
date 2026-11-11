import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// A fixed time zone with daylight saving time, so date math is tested
// the same way on every machine, DST switches included.
process.env.TZ = 'Europe/Vienna';

export default defineConfig({
	resolve: {
		// The obsidian package only ships types; tests run against a small stand-in.
		alias: { obsidian: fileURLToPath(new URL('./tests/support/obsidian.ts', import.meta.url)) },
	},
	test: {
		environment: 'jsdom',
		include: ['tests/**/*.test.ts'],
	},
});
