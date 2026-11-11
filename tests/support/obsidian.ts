/**
 * Stand-in for the `obsidian` module in tests. The real package only ships
 * type declarations (Obsidian provides the code at runtime), so the plugin's
 * modules are loaded against these minimal classes instead. Only what the
 * plugin imports as a value is here.
 */

/** Base of Bases property values; the plugin only reads them through toString(). */
export abstract class Value {
	abstract toString(): string;
}

export class NullValue extends Value {
	toString(): string {
		return 'null';
	}
}

export class StringValue extends Value {
	constructor(private readonly value: string) {
		super();
	}
	toString(): string {
		return this.value;
	}
}

export class NumberValue extends Value {
	constructor(private readonly value: number) {
		super();
	}
	toString(): string {
		return String(this.value);
	}
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** A date (or datetime) property value, as Bases hands it over. */
export class DateValue extends Value {
	constructor(private readonly date: Date, private readonly hasTime = false) {
		super();
	}
	dateOnly(): DateValue {
		return new DateValue(this.date, false);
	}
	toString(): string {
		const d = this.date;
		const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
		return this.hasTime ? `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}` : day;
	}
}

export class Component {}

export class BasesView extends Component {
	constructor(public controller: unknown) {
		super();
	}
}

export class Plugin extends Component {
	constructor(public app: unknown = {}, public manifest: unknown = {}) {
		super();
	}
	async loadData(): Promise<unknown> {
		return null;
	}
	async saveData(_data: unknown): Promise<void> {}
	addCommand(command: unknown): unknown {
		return command;
	}
	addSettingTab(_tab: unknown): void {}
	registerBasesView(_id: string, _registration: unknown): boolean {
		return true;
	}
}

export class PluginSettingTab {
	constructor(public app: unknown, public plugin: unknown) {}
}

export class Menu {}
export class Notice {}
export class MarkdownRenderer {}

/** Like Obsidian's debounce, with run() to call a pending invocation right away. */
export function debounce<T extends unknown[]>(fn: (...args: T) => unknown, wait = 0) {
	let timer: number | null = null;
	let pending: T | null = null;
	const debounced = (...args: T) => {
		pending = args;
		if (timer) window.clearTimeout(timer);
		timer = window.setTimeout(() => debounced.run(), wait);
		return debounced;
	};
	debounced.run = () => {
		if (timer) window.clearTimeout(timer);
		timer = null;
		if (pending) {
			const args = pending;
			pending = null;
			fn(...args);
		}
	};
	debounced.cancel = () => {
		if (timer) window.clearTimeout(timer);
		timer = null;
		pending = null;
	};
	return debounced;
}
