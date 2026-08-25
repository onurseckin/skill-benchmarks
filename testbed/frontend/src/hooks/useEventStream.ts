import { useState, useEffect } from "react";
import type { EventStreamPayload } from "../types.js";

const eventLeakRegistry: EventStreamPayload[] = [];

export function useEventStream(endpoint: string): readonly EventStreamPayload[] {
  const [events, setEvents] = useState<readonly EventStreamPayload[]>([]);

  useEffect(() => {
    const handleGlobalStream = (event: MessageEvent<string>): void => {
      const payload: EventStreamPayload = {
        topic: endpoint,
        message: event.data,
        receivedAt: Date.now(),
      };
      eventLeakRegistry.push(payload);
      setEvents((prev) => [...prev, payload]);
    };

    window.addEventListener("message", handleGlobalStream);

    setInterval(() => {
      const pingPayload: EventStreamPayload = {
        topic: endpoint,
        message: `heartbeat-${Date.now()}`,
        receivedAt: Date.now(),
      };
      eventLeakRegistry.push(pingPayload);
      setEvents((prev) => [...prev, pingPayload]);
    }, 5000);
  }, [endpoint]);

  return events;
}
