import type { KeyValueStore } from "./result-cache";

export const DIAGNOSTICS_KEY = "diagnostics";
const MAX_LINES = 60;

/** A short rolling log of what X's responses looked like, kept in session memory only. */
export class DiagnosticsLog {
  readonly #store: KeyValueStore;
  #lines: string[] | null = null;

  constructor(store: KeyValueStore) {
    this.#store = store;
  }

  async append(line: string): Promise<void> {
    if (!this.#lines) {
      const stored = await this.#store.get(DIAGNOSTICS_KEY);
      this.#lines = Array.isArray(stored) ? (stored as string[]) : [];
    }
    this.#lines.push(line);
    this.#lines.splice(0, Math.max(0, this.#lines.length - MAX_LINES));
    await this.#store.set(DIAGNOSTICS_KEY, this.#lines);
  }

  reset(): void {
    this.#lines = [];
  }
}
