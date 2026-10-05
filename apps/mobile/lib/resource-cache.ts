/** Process-local snapshots only: private content never goes into persistent storage. */
export class ResourceCache {
  private entries = new Map<string, { value: unknown; writtenAt: number }>();
  private pending = new Map<string, Promise<unknown>>();
  private revision = 0;
  private writeSequence = 0;
  private writes = new Map<string, number>();
  private identity = 0;
  private listeners = new Set<() => void>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 48,
    private readonly maxAgeMs = 5 * 60_000,
  ) {}

  scope(): string {
    return String(this.identity);
  }

  version(): number {
    return this.revision;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Identity changes also discard in-flight ownership, including A → B → A. */
  resetIdentity(): void {
    this.identity += 1;
    this.invalidate();
    for (const listener of this.listeners) listener();
  }

  invalidate(): void {
    this.revision += 1;
    this.entries.clear();
    this.pending.clear();
    this.writes.clear();
  }

  peek<T>(key: string, maxAgeMs = this.maxAgeMs): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.writtenAt > Math.min(maxAgeMs, this.maxAgeMs)) {
      if (this.now() - entry.writtenAt > this.maxAgeMs) {
        this.entries.delete(key);
        if (!this.pending.has(key)) this.writes.delete(key);
      }
      return undefined;
    }
    // Move a used snapshot to the end for bounded least-recently-used eviction.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value as T;
  }

  writtenAt(key: string): number | undefined {
    return this.entries.get(key)?.writtenAt;
  }

  remove(key: string): void {
    this.entries.delete(key);
    if (this.pending.has(key)) this.writes.set(key, ++this.writeSequence);
    else this.writes.delete(key);
  }

  write<T>(key: string, value: T): void {
    this.writes.set(key, ++this.writeSequence);
    this.entries.delete(key);
    this.entries.set(key, { value, writtenAt: this.now() });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
        if (!this.pending.has(oldest)) this.writes.delete(oldest);
      }
    }
  }

  fetch<T>(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing as Promise<T>;
    const revision = this.revision;
    const writeVersion = this.writes.get(key);
    const request = Promise.resolve()
      .then(load)
      .then((value) => {
        if (revision === this.revision && writeVersion === this.writes.get(key))
          this.write(key, value);
        return value;
      })
      .finally(() => {
        if (this.pending.get(key) === request) this.pending.delete(key);
        if (!this.entries.has(key) && !this.pending.has(key)) this.writes.delete(key);
      });
    this.pending.set(key, request);
    return request;
  }
}

export const mobileResourceCache = new ResourceCache();

/** Stable ordering prevents equivalent request objects from duplicating requests. */
export function resourceKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(resourceKey).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${resourceKey(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
