import type { ResourceMetricsSummary, ResourceProfileSample } from "./types.js";

export function computeMetricsSummary(
  samples: ReadonlyArray<ResourceProfileSample>,
): ResourceMetricsSummary {
  if (samples.length === 0) {
    return {
      cpu: {
        peakPercent: 0,
        meanPercent: 0,
        totalCpuTimeMs: 0,
      },
      memory: {
        peakRssBytes: 0,
        peakRssMb: 0,
        finalRssBytes: 0,
        limitBytes: 0,
        peakMemoryPercentage: 0,
      },
      io: {
        totalDiskReadBytes: 0,
        totalDiskWriteBytes: 0,
        totalNetworkRxBytes: 0,
        totalNetworkTxBytes: 0,
      },
      processes: {
        peakPidCount: 0,
      },
    };
  }

  let peakCpuPercent = 0;
  let totalCpuPercentSum = 0;

  let peakRssBytes = 0;
  let peakMemoryPercent = 0;
  let peakPidCount = 0;

  let minDiskRead = Number.POSITIVE_INFINITY;
  let maxDiskRead = 0;
  let minDiskWrite = Number.POSITIVE_INFINITY;
  let maxDiskWrite = 0;

  let minNetRx = Number.POSITIVE_INFINITY;
  let maxNetRx = 0;
  let minNetTx = Number.POSITIVE_INFINITY;
  let maxNetTx = 0;

  for (const sample of samples) {
    if (sample.cpuPercent > peakCpuPercent) {
      peakCpuPercent = sample.cpuPercent;
    }
    totalCpuPercentSum += sample.cpuPercent;

    if (sample.memoryRssBytes > peakRssBytes) {
      peakRssBytes = sample.memoryRssBytes;
    }
    if (sample.memoryPercent > peakMemoryPercent) {
      peakMemoryPercent = sample.memoryPercent;
    }

    if (sample.activePids > peakPidCount) {
      peakPidCount = sample.activePids;
    }

    if (sample.diskReadBytes < minDiskRead) {
      minDiskRead = sample.diskReadBytes;
    }
    if (sample.diskReadBytes > maxDiskRead) {
      maxDiskRead = sample.diskReadBytes;
    }

    if (sample.diskWriteBytes < minDiskWrite) {
      minDiskWrite = sample.diskWriteBytes;
    }
    if (sample.diskWriteBytes > maxDiskWrite) {
      maxDiskWrite = sample.diskWriteBytes;
    }

    if (sample.networkRxBytes < minNetRx) {
      minNetRx = sample.networkRxBytes;
    }
    if (sample.networkRxBytes > maxNetRx) {
      maxNetRx = sample.networkRxBytes;
    }

    if (sample.networkTxBytes < minNetTx) {
      minNetTx = sample.networkTxBytes;
    }
    if (sample.networkTxBytes > maxNetTx) {
      maxNetTx = sample.networkTxBytes;
    }
  }

  const meanCpuPercent = totalCpuPercentSum / samples.length;

  const firstSample = samples[0]!;
  const lastSample = samples[samples.length - 1]!;

  const firstCpuUs = firstSample.cpuUserUs + firstSample.cpuKernelUs;
  const lastCpuUs = lastSample.cpuUserUs + lastSample.cpuKernelUs;
  let totalCpuTimeMs = (lastCpuUs - firstCpuUs) / 1000;
  if (samples.length === 1) {
    totalCpuTimeMs = firstCpuUs / 1000;
  }
  if (totalCpuTimeMs < 0) {
    totalCpuTimeMs = 0;
  }

  const finalRssBytes = lastSample.memoryRssBytes;
  const limitBytes =
    lastSample.memoryLimitBytes > 0
      ? lastSample.memoryLimitBytes
      : Math.max(...samples.map((s) => s.memoryLimitBytes), 0);

  const peakRssMb = Math.round((peakRssBytes / (1024 * 1024)) * 100) / 100;

  if (limitBytes > 0 && peakMemoryPercent === 0) {
    peakMemoryPercent = (peakRssBytes / limitBytes) * 100;
  }

  const totalDiskReadBytes =
    samples.length === 1 ? firstSample.diskReadBytes : Math.max(0, maxDiskRead - minDiskRead);
  const totalDiskWriteBytes =
    samples.length === 1 ? firstSample.diskWriteBytes : Math.max(0, maxDiskWrite - minDiskWrite);
  const totalNetworkRxBytes =
    samples.length === 1 ? firstSample.networkRxBytes : Math.max(0, maxNetRx - minNetRx);
  const totalNetworkTxBytes =
    samples.length === 1 ? firstSample.networkTxBytes : Math.max(0, maxNetTx - minNetTx);

  return {
    cpu: {
      peakPercent: Math.round(peakCpuPercent * 100) / 100,
      meanPercent: Math.round(meanCpuPercent * 100) / 100,
      totalCpuTimeMs: Math.round(totalCpuTimeMs * 100) / 100,
    },
    memory: {
      peakRssBytes,
      peakRssMb,
      finalRssBytes,
      limitBytes,
      peakMemoryPercentage: Math.round(peakMemoryPercent * 100) / 100,
    },
    io: {
      totalDiskReadBytes,
      totalDiskWriteBytes,
      totalNetworkRxBytes,
      totalNetworkTxBytes,
    },
    processes: {
      peakPidCount,
    },
  };
}
