/**
 * Registry of in-flight asynchronous layer loads keyed by layer id.
 *
 * A layer-sync effect re-runs on every change to the layer list (another
 * layer's opacity slider included). Without a registry each run started a
 * second request for a layer whose first request was still in flight, both
 * added their result to the map, and the later one orphaned the earlier
 * layer. This keeps exactly one controller per key and lets a completed load
 * check whether it is still the current one.
 */
export class PendingLoads {
  private readonly controllers = new Map<string, AbortController>();

  /** Begin a load for `key`, aborting any previous load for the same key. */
  start(key: string): AbortController {
    this.controllers.get(key)?.abort();
    const controller = new AbortController();
    this.controllers.set(key, controller);
    return controller;
  }

  has(key: string): boolean {
    return this.controllers.has(key);
  }

  /** True when `controller` is the latest load started for `key`. */
  isCurrent(key: string, controller: AbortController): boolean {
    return this.controllers.get(key) === controller;
  }

  /** Forget `key` if `controller` is still its current load. */
  finish(key: string, controller: AbortController): void {
    if (this.isCurrent(key, controller)) this.controllers.delete(key);
  }

  cancel(key: string): void {
    this.controllers.get(key)?.abort();
    this.controllers.delete(key);
  }

  /** Abort every load whose key is not in `keep`. */
  cancelExcept(keep: ReadonlySet<string>): void {
    for (const key of Array.from(this.controllers.keys())) {
      if (!keep.has(key)) this.cancel(key);
    }
  }

  cancelAll(): void {
    this.cancelExcept(new Set());
  }
}
