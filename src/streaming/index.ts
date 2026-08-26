import { CanvasStreamer } from "./canvas-streamer.js";
import { TelemetryBroadcaster } from "./telemetry-broadcaster.js";
import type { BroadcasterOptions, CanvasStreamerOptions } from "./types.js";

export * from "./types.js";
export * from "./canvas-streamer.js";
export * from "./telemetry-broadcaster.js";

export function createCanvasStreamer(options?: CanvasStreamerOptions): CanvasStreamer {
  return new CanvasStreamer(options);
}

export function createTelemetryBroadcaster(options?: BroadcasterOptions): TelemetryBroadcaster {
  return new TelemetryBroadcaster(options);
}

export interface LiveStreamingEngine {
  readonly streamer: CanvasStreamer;
  readonly broadcaster: TelemetryBroadcaster;
}

export interface LiveStreamingEngineOptions {
  readonly streamer?: CanvasStreamerOptions;
  readonly broadcaster?: BroadcasterOptions;
}

export function createLiveStreamingEngine(
  options?: LiveStreamingEngineOptions,
): LiveStreamingEngine {
  const streamerOptions = options !== undefined ? options.streamer : undefined;
  const broadcasterOptions = options !== undefined ? options.broadcaster : undefined;
  const streamer = new CanvasStreamer(streamerOptions);
  const broadcaster = new TelemetryBroadcaster(broadcasterOptions);
  return {
    streamer,
    broadcaster,
  };
}
