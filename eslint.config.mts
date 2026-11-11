import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';

const browserGlobals: Record<string, boolean> = (globals as { browser: Record<string, boolean> }).browser;
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...browserGlobals,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// Runs in Node when the tests start, not in Obsidian.
		files: ['vitest.config.mts'],
		languageOptions: { globals: { ...(globals as { node: Record<string, boolean> }).node } },
		rules: { 'obsidianmd/no-nodejs-modules': 'off' },
	},
);
