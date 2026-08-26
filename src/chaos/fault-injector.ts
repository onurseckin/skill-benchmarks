import type { IContainerInstance } from "../infrastructure/container/types.js";
import type {
  ChaosFault,
  ChaosFaultExecutionResult,
  ChaosFaultStatus,
  IFaultInjector,
} from "./types.js";

interface ActiveFaultRecord {
  readonly fault: ChaosFault;
  readonly result: ChaosFaultExecutionResult;
  readonly cleanupCommands: readonly string[];
  readonly cleanupTimer?: ReturnType<typeof setTimeout>;
}

export class ContainerFaultInjector implements IFaultInjector {
  private readonly containerInstance: IContainerInstance | null;
  private readonly activeRecords = new Map<string, ActiveFaultRecord>();

  constructor(containerInstance?: IContainerInstance | null) {
    this.containerInstance = containerInstance ?? null;
  }

  public async inject(fault: ChaosFault): Promise<ChaosFaultExecutionResult> {
    const startedAt = new Date().toISOString();
    const cleanupCommands = this.buildCleanupCommands(fault);
    const injectionCommands = this.buildInjectionCommands(fault);

    let status: ChaosFaultStatus = "active";
    let errorMessage: string | undefined;

    try {
      if (this.containerInstance !== null && injectionCommands.length > 0) {
        for (const cmd of injectionCommands) {
          const res = await this.containerInstance.executeCommand(cmd);
          if (res.exitCode !== 0 && fault.kind !== "process_kill") {
            status = "failed";
            errorMessage = res.stderr || `Exit code ${res.exitCode}`;
            break;
          }
        }
      }
    } catch (err) {
      status = "failed";
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    const durationMs = fault.durationMs ?? 1000;
    const result: ChaosFaultExecutionResult = {
      scheduleItemId: fault.id,
      faultKind: fault.kind,
      status,
      injectedAt: startedAt,
      durationMs,
      errorMessage,
      metricsBefore: {
        timestampMs: Date.now(),
      },
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (status === "active" && durationMs > 0 && durationMs < 86400000) {
      timer = setTimeout(() => {
        void this.restore(fault.id);
      }, durationMs);
    }

    this.activeRecords.set(fault.id, {
      fault,
      result,
      cleanupCommands,
      cleanupTimer: timer,
    });

    return result;
  }

  public async restore(faultId: string): Promise<boolean> {
    const record = this.activeRecords.get(faultId);
    if (!record) {
      return false;
    }

    if (record.cleanupTimer) {
      clearTimeout(record.cleanupTimer);
    }

    if (this.containerInstance !== null && record.cleanupCommands.length > 0) {
      for (const cmd of record.cleanupCommands) {
        try {
          await this.containerInstance.executeCommand(cmd);
        } catch {}
      }
    }

    const updatedResult: ChaosFaultExecutionResult = {
      ...record.result,
      status: "restored",
      restoredAt: new Date().toISOString(),
      metricsAfter: {
        restoredTimestampMs: Date.now(),
      },
    };

    this.activeRecords.set(faultId, {
      ...record,
      result: updatedResult,
    });

    return true;
  }

  public async restoreAll(): Promise<void> {
    const activeIds = Array.from(this.activeRecords.keys());
    for (const faultId of activeIds) {
      await this.restore(faultId);
    }
  }

  public getActiveFaults(): readonly ChaosFaultExecutionResult[] {
    const active: ChaosFaultExecutionResult[] = [];
    for (const record of this.activeRecords.values()) {
      if (record.result.status === "active") {
        active.push(record.result);
      }
    }
    return active;
  }

  public getAllExecutionResults(): readonly ChaosFaultExecutionResult[] {
    return Array.from(this.activeRecords.values()).map((r) => r.result);
  }

  private buildInjectionCommands(fault: ChaosFault): readonly string[] {
    switch (fault.kind) {
      case "network_latency": {
        const jitter = fault.jitterMs ? ` ${fault.jitterMs}ms` : "";
        return [
          `tc qdisc del dev eth0 root 2>/dev/null || true`,
          `tc qdisc add dev eth0 root netem delay ${fault.delayMs}ms${jitter}`,
        ];
      }
      case "packet_drop": {
        return [
          `tc qdisc del dev eth0 root 2>/dev/null || true`,
          `tc qdisc add dev eth0 root netem loss ${fault.dropPercentage}%`,
        ];
      }
      case "process_kill": {
        if (fault.pid) {
          return [`kill -${fault.signal} ${fault.pid}`];
        }
        if (fault.targetProcessName) {
          return [`pkill -${fault.signal} -f "${fault.targetProcessName}" || true`];
        }
        return [];
      }
      case "disk_pressure": {
        const target = `${fault.targetPath.replace(/\/$/, "")}/.chaos_fill_${fault.id}.tmp`;
        if (fault.fillStrategy === "random_fill") {
          return [
            `dd if=/dev/urandom of="${target}" bs=1M count=${fault.fillBytesMb} 2>/dev/null || true`,
          ];
        }
        return [
          `dd if=/dev/zero of="${target}" bs=1M count=${fault.fillBytesMb} 2>/dev/null || true`,
        ];
      }
      case "cpu_throttle": {
        const cores = fault.coresToStress ?? 1;
        return [
          `sh -c 'for i in $(seq 1 ${cores}); do while :; do :; done & done; echo $! > /tmp/.chaos_cpu_${fault.id}.pid' 2>/dev/null || true`,
        ];
      }
      case "oom_simulation": {
        return [
          `python3 -c 'import time; a = bytearray(${fault.memoryBalloonMb} * 1024 * 1024); time.sleep(60)' 2>/dev/null & echo $! > /tmp/.chaos_oom_${fault.id}.pid || true`,
        ];
      }
      case "network_blackhole": {
        const cmds: string[] = [];
        if (fault.blockedHosts) {
          for (const host of fault.blockedHosts) {
            cmds.push(`iptables -A OUTPUT -d ${host} -j DROP 2>/dev/null || true`);
          }
        }
        if (fault.blockedPorts) {
          for (const port of fault.blockedPorts) {
            cmds.push(`iptables -A OUTPUT -p tcp --dport ${port} -j DROP 2>/dev/null || true`);
          }
        }
        return cmds;
      }
      case "io_throttle": {
        return [`sync; echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true`];
      }
    }
  }

  private buildCleanupCommands(fault: ChaosFault): readonly string[] {
    switch (fault.kind) {
      case "network_latency":
      case "packet_drop": {
        return [`tc qdisc del dev eth0 root 2>/dev/null || true`];
      }
      case "process_kill": {
        return [];
      }
      case "disk_pressure": {
        const target = `${fault.targetPath.replace(/\/$/, "")}/.chaos_fill_${fault.id}.tmp`;
        return [`rm -f "${target}" 2>/dev/null || true`];
      }
      case "cpu_throttle": {
        return [
          `if [ -f /tmp/.chaos_cpu_${fault.id}.pid ]; then kill -9 $(cat /tmp/.chaos_cpu_${fault.id}.pid) 2>/dev/null || true; rm -f /tmp/.chaos_cpu_${fault.id}.pid; fi`,
        ];
      }
      case "oom_simulation": {
        return [
          `if [ -f /tmp/.chaos_oom_${fault.id}.pid ]; then kill -9 $(cat /tmp/.chaos_oom_${fault.id}.pid) 2>/dev/null || true; rm -f /tmp/.chaos_oom_${fault.id}.pid; fi`,
        ];
      }
      case "network_blackhole": {
        return [`iptables -F OUTPUT 2>/dev/null || true`];
      }
      case "io_throttle": {
        return [];
      }
    }
  }
}
