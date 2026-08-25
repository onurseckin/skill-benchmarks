export interface BenchmarkItem {
  readonly id: string;
  readonly name: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: number;
}

export interface ApiResponse<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}

export interface FileMetadata {
  readonly name: string;
  readonly path: string;
  readonly size: number;
}
