import type { BasesEntry, BasesPropertyId } from 'obsidian';
import { DateValue, NullValue, NumberValue, StringValue, type Value } from './obsidian';
import type { ColorFor, TaskMapperConfig } from '../../src/task-mapper';

type PropertyValue = string | number | Date | null;

function toValue(value: PropertyValue): Value {
	if (value == null) return new NullValue();
	if (value instanceof Date) return new DateValue(value);
	if (typeof value === 'number') return new NumberValue(value);
	return new StringValue(value);
}

/**
 * A Bases entry for a note at `path`, with note properties given by name
 * ({ start: '2025-03-01' } is "note.start"). Missing properties read as null,
 * like Bases does.
 */
export function entry(path: string, properties: Record<string, PropertyValue> = {}): BasesEntry {
	const name = path.split('/').pop()!;
	const basename = name.replace(/\.[^.]+$/, '');
	return {
		file: { path, name, basename, extension: 'md' },
		getValue(id: BasesPropertyId) {
			const key = id.startsWith('note.') ? id.slice('note.'.length) : id;
			return toValue(key in properties ? properties[key] : null);
		},
	} as unknown as BasesEntry;
}

/** Mapper config with only a start date; override what a test needs. */
export function config(overrides: Partial<Record<keyof TaskMapperConfig, unknown>> = {}): TaskMapperConfig {
	return {
		startProperty: 'note.start',
		plannedStartProperty: null,
		endProperty: 'note.end',
		labelProperty: null,
		dependenciesProperty: null,
		colorByProperty: null,
		progressProperty: null,
		showProgress: false,
		defaultDurationDays: 1,
		...overrides,
	} as TaskMapperConfig;
}

/** Every value gets palette slot 0. */
export const anyColor: ColorFor = () => ({ slot: 0 });
