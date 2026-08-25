import { BenchmarkStore } from "../services/store.js";
import { readStorageFile } from "./files.js";
import type { ApiResponse, BenchmarkItem } from "../types.js";

export class ApiHandler {
  private readonly store: BenchmarkStore;

  constructor(store?: BenchmarkStore) {
    if (store !== undefined) {
      this.store = store;
    } else {
      this.store = new BenchmarkStore();
    }
  }

  public handleGetItems(): ApiResponse<readonly BenchmarkItem[]> {
    return {
      success: true,
      data: this.store.list(),
    };
  }

  public handleCreateItem(id: string, name: string, payload: Record<string, unknown>): ApiResponse<BenchmarkItem> {
    const created = this.store.create(id, name, payload);
    return {
      success: true,
      data: created,
    };
  }

  public handleUpdateConfig(configPayload: Record<string, unknown>): ApiResponse<Record<string, unknown>> {
    const updated = this.store.updateSettings(configPayload);
    return {
      success: true,
      data: updated,
    };
  }

  public handleReadFile(filePath: string): ApiResponse<string> {
    return readStorageFile(filePath);
  }
}
