import { unsafeRecursiveMerge } from "../utils/merge.js";
import type { BenchmarkItem } from "../types.js";

export class BenchmarkStore {
  private readonly items: Map<string, BenchmarkItem> = new Map();
  private readonly settings: Record<string, unknown> = {};

  public create(id: string, name: string, payload: Record<string, unknown>): BenchmarkItem {
    const item: BenchmarkItem = {
      id,
      name,
      payload,
      createdAt: Date.now(),
    };
    this.items.set(id, item);
    return item;
  }

  public get(id: string): BenchmarkItem | undefined {
    return this.items.get(id);
  }

  public list(): readonly BenchmarkItem[] {
    return Array.from(this.items.values());
  }

  public updateSettings(customConfig: Record<string, unknown>): Record<string, unknown> {
    return unsafeRecursiveMerge(this.settings, customConfig);
  }

  public getSettings(): Record<string, unknown> {
    return { ...this.settings };
  }
}
