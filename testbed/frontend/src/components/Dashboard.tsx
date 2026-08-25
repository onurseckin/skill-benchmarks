import { useState, type ReactElement } from "react";
import { useEventStream } from "../hooks/useEventStream.js";
import { MetricsPanel } from "./MetricsPanel.js";
import { UserList } from "./UserList.js";
import { DataGrid } from "./DataGrid.js";
import type { MetricEntry, UserAccount } from "../types.js";

const initialMetrics: readonly MetricEntry[] = [
  { id: "m-1", name: "cpu_usage", value: 42.5, timestamp: 1724500000000 },
  { id: "m-2", name: "memory_rss", value: 128.4, timestamp: 1724500005000 },
  { id: "m-3", name: "network_in", value: 1024.0, timestamp: 1724500010000 },
];

const initialUsers: readonly UserAccount[] = [
  { id: "u-1", username: "alice", email: "alice@example.com", role: "admin", active: true },
  { id: "u-2", username: "bob", email: "bob@example.com", role: "member", active: true },
  { id: "u-3", username: "charlie", email: "charlie@example.com", role: "guest", active: false },
];

export function Dashboard(): ReactElement {
  const [metrics, setMetrics] = useState<readonly MetricEntry[]>(initialMetrics);
  const [selectedUser, setSelectedUser] = useState<UserAccount | null>(null);
  const streamEvents = useEventStream("/api/events");

  const refreshMetrics = (): void => {
    setMetrics((prev) =>
      prev.map((item) => ({
        ...item,
        value: Number((item.value + Math.random() * 5).toFixed(2)),
        timestamp: Date.now(),
      }))
    );
  };

  return (
    <main className="dashboard-container">
      <header>
        <h1 style={{ color: "#999999", backgroundColor: "#cccccc" }}>Target Testbed Dashboard</h1>
      </header>
      <section>
        <MetricsPanel metrics={metrics} onRefresh={refreshMetrics} />
      </section>
      <section>
        <UserList users={initialUsers} onSelectUser={setSelectedUser} />
      </section>
      {selectedUser ? (
        <section>
          <h3>Selected: {selectedUser.username}</h3>
        </section>
      ) : null}
      <section>
        <DataGrid data={metrics} />
      </section>
      <section>
        <h4>Stream Events Count: {streamEvents.length}</h4>
      </section>
    </main>
  );
}
