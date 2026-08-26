import type {
  BroadcasterMetrics,
  BroadcasterOptions,
  BroadcastSubscriber,
  CanvasFrame,
  ServerBroadcastMessage,
  TelemetryChunk,
} from "./types.js";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15000;
const DEFAULT_CLIENT_TIMEOUT_MS = 30000;

export class TelemetryBroadcaster {
  private readonly subscribers: Map<string, BroadcastSubscriber> = new Map();
  private readonly channelSubscriptions: Map<string, Set<string>> = new Map();
  private readonly heartbeatIntervalMs: number;
  private readonly clientTimeoutMs: number;
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private isRunning: boolean = false;
  private totalFramesSent: number = 0;
  private totalBytesBroadcast: number = 0;
  private droppedFrames: number = 0;
  private readonly startTime: number = Date.now();
  private broadcastSequence: number = 0;
  private readonly onConnectCallback?: (subscriber: BroadcastSubscriber) => void;
  private readonly onDisconnectCallback?: (subscriber: BroadcastSubscriber) => void;
  private readonly onErrorCallback?: (error: Error) => void;

  constructor(options?: BroadcasterOptions) {
    if (options !== undefined && options.heartbeatIntervalMs !== undefined) {
      this.heartbeatIntervalMs = options.heartbeatIntervalMs;
    } else {
      this.heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS;
    }

    if (options !== undefined && options.clientTimeoutMs !== undefined) {
      this.clientTimeoutMs = options.clientTimeoutMs;
    } else {
      this.clientTimeoutMs = DEFAULT_CLIENT_TIMEOUT_MS;
    }

    this.onConnectCallback = options !== undefined ? options.onClientConnect : undefined;
    this.onDisconnectCallback = options !== undefined ? options.onClientDisconnect : undefined;
    this.onErrorCallback = options !== undefined ? options.onError : undefined;
  }

  public registerSubscriber(subscriber: BroadcastSubscriber): void {
    this.subscribers.set(subscriber.id, subscriber);
    this.subscribe(subscriber.id, subscriber.channel);
    if (this.onConnectCallback !== undefined) {
      this.onConnectCallback(subscriber);
    }
  }

  public removeSubscriber(subscriberId: string): void {
    const subscriber = this.subscribers.get(subscriberId);
    if (subscriber === undefined) return;
    this.unsubscribeAll(subscriberId);
    this.subscribers.delete(subscriberId);
    if (this.onDisconnectCallback !== undefined) {
      this.onDisconnectCallback(subscriber);
    }
  }

  public subscribe(subscriberId: string, channel: string): void {
    let channelSet = this.channelSubscriptions.get(channel);
    if (channelSet === undefined) {
      channelSet = new Set();
      this.channelSubscriptions.set(channel, channelSet);
    }
    channelSet.add(subscriberId);
  }

  public unsubscribe(subscriberId: string, channel: string): void {
    const channelSet = this.channelSubscriptions.get(channel);
    if (channelSet === undefined) return;
    channelSet.delete(subscriberId);
    if (channelSet.size === 0) {
      this.channelSubscriptions.delete(channel);
    }
  }

  public unsubscribeAll(subscriberId: string): void {
    for (const [channel, set] of this.channelSubscriptions.entries()) {
      set.delete(subscriberId);
      if (set.size === 0) {
        this.channelSubscriptions.delete(channel);
      }
    }
  }

  public getSubscriberCount(channel?: string): number {
    if (channel !== undefined) {
      const channelSet = this.channelSubscriptions.get(channel);
      return channelSet !== undefined ? channelSet.size : 0;
    }
    return this.subscribers.size;
  }

  public getActiveChannels(): readonly string[] {
    return Array.from(this.channelSubscriptions.keys());
  }

  public broadcast(channel: string, message: ServerBroadcastMessage | string | Uint8Array): void {
    const subscriberIds = this.channelSubscriptions.get(channel);
    if (subscriberIds === undefined) return;
    if (subscriberIds.size === 0) return;

    let payloadLength = 0;
    if (typeof message === "string") {
      payloadLength = message.length;
    } else if (message instanceof Uint8Array) {
      payloadLength = message.byteLength;
    } else {
      payloadLength = JSON.stringify(message).length;
    }

    for (const subId of subscriberIds) {
      const subscriber = this.subscribers.get(subId);
      if (subscriber === undefined) continue;
      if (!subscriber.isAlive) {
        this.droppedFrames = this.droppedFrames + 1;
        continue;
      }
      try {
        subscriber.send(message);
        this.totalBytesBroadcast = this.totalBytesBroadcast + payloadLength;
      } catch (err) {
        this.droppedFrames = this.droppedFrames + 1;
        if (this.onErrorCallback !== undefined && err instanceof Error) {
          this.onErrorCallback(err);
        }
      }
    }
  }

  public broadcastToAll(message: ServerBroadcastMessage | string | Uint8Array): void {
    let payloadLength = 0;
    if (typeof message === "string") {
      payloadLength = message.length;
    } else if (message instanceof Uint8Array) {
      payloadLength = message.byteLength;
    } else {
      payloadLength = JSON.stringify(message).length;
    }

    for (const subscriber of this.subscribers.values()) {
      if (!subscriber.isAlive) {
        this.droppedFrames = this.droppedFrames + 1;
        continue;
      }
      try {
        subscriber.send(message);
        this.totalBytesBroadcast = this.totalBytesBroadcast + payloadLength;
      } catch (err) {
        this.droppedFrames = this.droppedFrames + 1;
        if (this.onErrorCallback !== undefined && err instanceof Error) {
          this.onErrorCallback(err);
        }
      }
    }
  }

  public broadcastFrame(channel: string, frame: CanvasFrame): void {
    this.broadcastSequence = this.broadcastSequence + 1;
    const message: ServerBroadcastMessage = {
      type: "frame",
      channel,
      timestamp: frame.timestamp,
      sequence: this.broadcastSequence,
      data: frame,
    };
    this.totalFramesSent = this.totalFramesSent + 1;
    this.broadcast(channel, message);
  }

  public broadcastChunk(chunk: TelemetryChunk): void {
    this.broadcastSequence = this.broadcastSequence + 1;
    const message: ServerBroadcastMessage = {
      type: "telemetry",
      channel: chunk.channel,
      timestamp: chunk.timestamp,
      sequence: this.broadcastSequence,
      data: chunk,
    };
    this.broadcast(chunk.channel, message);
  }

  public broadcastMetrics(channel: string, metrics: Readonly<Record<string, unknown>>): void {
    this.broadcastSequence = this.broadcastSequence + 1;
    const message: ServerBroadcastMessage = {
      type: "stats",
      channel,
      timestamp: Date.now(),
      sequence: this.broadcastSequence,
      data: metrics,
    };
    this.broadcast(channel, message);
  }

  public getMetrics(): BroadcasterMetrics {
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    return {
      totalClients: this.subscribers.size,
      totalChannels: this.channelSubscriptions.size,
      totalFramesSent: this.totalFramesSent,
      totalBytesBroadcast: this.totalBytesBroadcast,
      uptimeSeconds,
      droppedFrames: this.droppedFrames,
    };
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timerHandle = setInterval(() => {
      this.performHeartbeatSweep();
    }, this.heartbeatIntervalMs);
  }

  private performHeartbeatSweep(): void {
    const now = Date.now();
    const deadSubscribers: string[] = [];

    for (const [id, subscriber] of this.subscribers.entries()) {
      if (!subscriber.isAlive) {
        deadSubscribers.push(id);
        continue;
      }
      const elapsed = now - subscriber.lastPingAt;
      if (elapsed > this.clientTimeoutMs) {
        deadSubscribers.push(id);
        continue;
      }

      this.broadcastSequence = this.broadcastSequence + 1;
      const pingMessage: ServerBroadcastMessage = {
        type: "pong",
        channel: subscriber.channel,
        timestamp: now,
        sequence: this.broadcastSequence,
        data: { ping: true },
      };

      try {
        subscriber.send(pingMessage);
      } catch {
        deadSubscribers.push(id);
      }
    }

    for (const deadId of deadSubscribers) {
      const sub = this.subscribers.get(deadId);
      if (sub !== undefined) {
        try {
          sub.close();
        } catch {
          void 0;
        }
      }
      this.removeSubscriber(deadId);
    }
  }

  public stop(): void {
    if (this.timerHandle !== null) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
    for (const subscriber of this.subscribers.values()) {
      try {
        subscriber.close();
      } catch {
        void 0;
      }
    }
    this.subscribers.clear();
    this.channelSubscriptions.clear();
    this.isRunning = false;
  }
}
