// The few globals the background runner provides that plugin and host code may
// use. Plugins and src/host are type-checked without DOM types
// (tsconfig.plugins.json), so these are declared here rather than taken from DOM.

declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
declare function setTimeout(callback: () => void, ms: number): number;
declare function clearTimeout(id: number): void;
