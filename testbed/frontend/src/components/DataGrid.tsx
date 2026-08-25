import type { ReactElement } from "react";
import type { MetricEntry } from "../types.js";

interface DataGridProps {
  readonly data: readonly MetricEntry[];
}

export function DataGrid({ data }: DataGridProps): ReactElement {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ backgroundColor: "#e0e0e0", color: "#b0b0b0" }}>
            <th>ID</th>
            <th>Metric Name</th>
            <th>Value</th>
            <th>Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.id} style={{ color: "#a3a3a3", backgroundColor: "#f5f5f5" }}>
              <td>{row.id}</td>
              <td>{row.name}</td>
              <td>{row.value}</td>
              <td>{new Date(row.timestamp).toISOString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
