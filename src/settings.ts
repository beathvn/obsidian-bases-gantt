import { App, PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import type GanttForBasesPlugin from './main';
import { GanttChartView } from './gantt-view';
import { MAX_FIXED_COLORS } from './note-mapper';

export interface GanttForBasesSettings {
	/** Dragging a note also shifts every note that depends on it, directly or transitively. */
	moveDependentNotes: boolean;
	/** How many days a note without an end date is drawn. */
	defaultDurationDays: number;
	/**
	 * Color slot per shown value of the color-by property, per view
	 * ("Projects.base::Gantt::note.status" → "done" → 2), so adding a value
	 * never recolors others. A value no longer shown frees its slot.
	 */
	colorAssignments: Record<string, Record<string, number>>;
	/** Colors fixed for specific values of the color-by property; other values use the palette. */
	valueColors: ValueColor[];
	/** Show the popup when resting on a bar. */
	showPopup: boolean;
	/** Note properties listed in the hover popup, in this order. */
	popupProperties: string[];
	/** Show a preview of the note's content in the hover popup. */
	showNotePreview: boolean;
}

export interface ValueColor {
	value: string;
	/** CSS color, e.g. "#2e9e44". */
	color: string;
}

export const DEFAULT_SETTINGS: GanttForBasesSettings = {
	moveDependentNotes: false,
	defaultDurationDays: 1,
	colorAssignments: {},
	valueColors: [],
	showPopup: true,
	popupProperties: [],
	showNotePreview: true,
};

export class GanttForBasesSettingTab extends PluginSettingTab {
	plugin: GanttForBasesPlugin;

	constructor(app: App, plugin: GanttForBasesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const valueColors = this.plugin.settings.valueColors;
		return [
			{
				name: 'Move dependent notes along',
				desc: 'Off by default: dragging a bar only changes that note. Turn on to shift every note that depends on it by the same amount too, which rewrites the dates of those notes.',
				control: { type: 'toggle', key: 'moveDependentNotes' },
			},
			{
				name: 'Default length without end date',
				desc: 'How many days a note without an end date is drawn. Dragging its right edge sets a real end date.',
				control: {
					type: 'number',
					key: 'defaultDurationDays',
					min: 1,
					step: 1,
					placeholder: String(DEFAULT_SETTINGS.defaultDurationDays),
					validate: (days) => (Number.isInteger(days) && days >= 1 ? undefined : 'Enter a whole number of days, at least 1.'),
				},
			},
			{
				type: 'group',
				heading: 'Hover',
				items: [
					{
						name: 'Show details on hover',
						desc: 'Show a popup with the note\'s dates, progress and dependencies when you rest the pointer on a bar. The two settings below only apply while this is on.',
						control: { type: 'toggle', key: 'showPopup' },
					},
					{
						name: 'Properties on hover',
						desc: 'Note properties to show in the popup, separated by commas. Properties a note doesn\'t have are left out.',
						control: { type: 'text', key: 'popupProperties', placeholder: 'Example: status, owner, priority' },
					},
					{
						name: 'Note preview on hover',
						desc: 'Show a scrollable preview of the note\'s content in the popup.',
						control: { type: 'toggle', key: 'showNotePreview' },
					},
				],
			},
			{
				type: 'list',
				heading: 'Value colors',
				cls: 'gantt-for-bases-value-colors',
				emptyState: `Give specific values of the view's Color by property a fixed color (matched ignoring case), up to ${MAX_FIXED_COLORS}. Values not listed here get a color automatically.`,
				items: valueColors.map((entry) => ({
					name: entry.value || 'New value',
					render: (setting) => {
						setting
							.addColorPicker((picker) => picker
								.setValue(entry.color)
								.onChange(async (color) => {
									entry.color = color;
									await this.saveAndRefresh();
								}))
							.addText((text) => text
								.setPlaceholder('Value, for example done')
								.setValue(entry.value)
								.onChange(async (value) => {
									entry.value = value;
									await this.saveAndRefresh();
								}));
					},
				})),
				onDelete: (index) => {
					valueColors.splice(index, 1);
					void this.saveAndRefresh();
					this.update();
				},
				addItem: {
					name: 'Add value',
					action: () => {
						valueColors.push({ value: '', color: '#3b82f6' });
						void this.plugin.saveSettings();
						this.update();
					},
				},
			},
		];
	}

	getControlValue(key: string): unknown {
		if (key === 'popupProperties') return this.plugin.settings.popupProperties.join(', ');
		return super.getControlValue(key);
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.plugin.settings;
		if (key === 'popupProperties') {
			settings.popupProperties = String(value).split(',').map((p) => p.trim()).filter(Boolean);
			await this.plugin.saveSettings();
			return;
		}
		await super.setControlValue(key, value);
		if (key === 'moveDependentNotes') {
			for (const view of GanttChartView.instances) view.applyPluginSettings();
		} else if (key === 'defaultDurationDays') {
			// Part of the note mapping, so open charts are rebuilt.
			for (const view of GanttChartView.instances) view.onDataUpdated();
		}
	}

	private async saveAndRefresh(): Promise<void> {
		await this.plugin.saveSettings();
		for (const view of GanttChartView.instances) view.onDataUpdated();
	}
}
