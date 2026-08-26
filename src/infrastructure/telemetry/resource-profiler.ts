import type {
  DockerCpuStats,
  DockerStatsRaw,
  ResourceMetricsSummary,
  ResourceProfileSample,
} from "./types.js";
import { computeMetricsSummary } from "./metrics-summary.js";

export const DEFAULT_PROFILER_INTERVAL_MS = 100;

export interface ResourceProfilerOptions {
  readonly containerId?: string;
  readonly sampleIntervalMs?: number;
  readonly statsProvider?: () => Promise<DockerStatsRaw | null>;
  readonly onSample?: (sample: ResourceProfileSample) => void;
}

export class ResourceProfiler {
  public readonly containerId?: string;
  public readonly sampleIntervalMs: number;

  private readonly statsProvider?: () => Promise<DockerStatsRaw | null>;
  private readonly samples: ResourceProfileSample[] = [];
  private readonly listeners: Set<(sample: ResourceProfileSample) => void> = new Set();

  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning: boolean = false;
  private lastCpuStats: DockerCpuStats | null = null;

  constructor(options: ResourceProfilerOptions = {}) {
    this.containerId = options.containerId;
    this.sampleIntervalMs = options.sampleIntervalMs ?? DEFAULT_PROFILER_INTERVAL_MS;
    this.statsProvider = options.statsProvider;

    if (options.onSample) {
      this.listeners.add(options.onSample);
    }
  }

  public get active(): boolean {
    return this.isRunning;
  }

  public get sampleCount(): number {
    return this.samples.length;
  }

  public start(): void {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;

    if (this.statsProvider) {
      void this.pollOnce();

      this.timer = setInterval(() => {
        void this.pollOnce();
      }, this.sampleIntervalMs);

      if (typeof this.timer === "object" && "unref" in this.timer) {
        this.timer.unref();
      }
    }
  }

  public stop(): void {
    if (!this.isRunning) {
      return;
    }
    this.isRunning = false;

    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public recordRawStats(raw: DockerStatsRaw): ResourceProfileSample {
    const sample = this.parseDockerStats(raw);
    this.samples.push(sample);

    for (const listener of this.listeners) {
      try {
        listener(sample);
      } catch {}
    }

    return sample;
  }

  public recordSample(sample: ResourceProfileSample): void {
    this.samples.push(sample);

    for (const listener of this.listeners) {
      try {
        listener(sample);
      } catch {}
    }
  }

  public getSamples(): ReadonlyArray<ResourceProfileSample> {
    return [...this.samples];
  }

  public getLatestSample(): ResourceProfileSample | undefined {
    return this.samples[this.samples.length - 1];
  }

  public clearSamples(): void {
    this.samples.length = 0;
    this.lastCpuStats = null;
  }

  public getMetricsSummary(): ResourceMetricsSummary {
    return computeMetricsSummary(this.samples);
  }

  public subscribe(listener: (sample: ResourceProfileSample) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private parseDockerStats(raw: DockerStatsRaw): ResourceProfileSample {
    const timestampMs = Date.now();

    const cpu = raw.cpu_stats;
    const precpu = raw.precpu_stats ?? this.lastCpuStats;

    let cpuPercent = 0;
    let cpuUserUs = 0;
    let cpuKernelUs = 0;

    if (cpu) {
      const totalUsage = cpu.cpu_usage.total_usage;
      const prevTotalUsage = precpu?.cpu_usage.total_usage ?? 0;
      const cpuDelta = totalUsage - prevTotalUsage;

      const systemUsage = cpu.system_cpu_usage ?? 0;
      const prevSystemUsage = precpu?.system_cpu_usage ?? 0;
      const systemDelta = systemUsage - prevSystemUsage;

      const onlineCpus = cpu.online_cpus ?? (cpu.cpu_usage.usage_in_usermode ? 1 : 1);

      if (systemDelta > 0 && cpuDelta >= 0) {
        cpuPercent = (cpuDelta / systemDelta) * onlineCpus * 100;
        cpuPercent = Math.round(cpuPercent * 100) / 100;
      }

      cpuUserUs = Math.round((cpu.cpu_usage.usage_in_usermode ?? 0) / 1000);
      cpuKernelUs = Math.round((cpu.cpu_usage.usage_in_kernelmode ?? 0) / 1000);

      this.lastCpuStats = cpu;
    }

    const mem = raw.memory_stats;
    let memoryRssBytes = 0;
    let memoryCacheBytes = 0;
    let memoryLimitBytes = 0;
    let memoryPercent = 0;

    if (mem) {
      memoryLimitBytes = mem.limit ?? 0;
      memoryCacheBytes = mem.stats?.cache ?? mem.stats?.inactive_file ?? 0;

      const rawUsage = mem.usage ?? 0;
      if (mem.stats?.active_anon !== undefined) {
        memoryRssBytes = (mem.stats.active_anon ?? 0) + (mem.stats.inactive_anon ?? 0);
      } else {
        memoryRssBytes = Math.max(0, rawUsage - memoryCacheBytes);
      }

      if (memoryLimitBytes > 0) {
        memoryPercent = (memoryRssBytes / memoryLimitBytes) * 100;
        memoryPercent = Math.round(memoryPercent * 100) / 100;
      }
    }

    let diskReadBytes = 0;
    let diskWriteBytes = 0;
    if (raw.blkio_stats?.io_service_bytes_recursive) {
      for (const entry of raw.blkio_stats.io_service_bytes_recursive) {
        const op = entry.op.toLowerCase();
        if (op === "read" || op === "r") {
          diskReadBytes += entry.value;
        } else if (op === "write" || op === "w") {
          diskWriteBytes += entry.value;
        }
      }
    }

    let networkRxBytes = 0;
    let networkTxBytes = 0;
    if (raw.networks) {
      for (const iface of Object.values(raw.networks)) {
        networkRxBytes += iface.rx_bytes;
        networkTxBytes += iface.tx_bytes;
      }
    }

    const activePids = raw.pids_stats?.current ?? 0;

    return {
      timestampMs,
      cpuPercent,
      cpuUserUs,
      cpuKernelUs,
      memoryRssBytes,
      memoryCacheBytes,
      memoryLimitBytes,
      memoryPercent,
      diskReadBytes,
      diskWriteBytes,
      networkRxBytes,
      networkTxBytes,
      activePids,
    };
  }

  private async pollOnce(): Promise<void> {
    if (!this.isRunning || !this.statsProvider) {
      return;
    }

    try {
      const raw = await this.statsProvider();
      if (raw) {
        this.recordRawStats(raw);
      }
    } catch {}
  }
}
