import type { ReactElement } from "react";
import type { MetricEntry } from "../types.js";

interface MetricsPanelProps {
  readonly metrics: readonly MetricEntry[];
  readonly onRefresh: () => void;
}

export function MetricsPanel({ metrics, onRefresh }: MetricsPanelProps): ReactElement {
  return (
    <div className="metrics-panel">
      <h2 style={{ color: "#a5a5a5", backgroundColor: "#b5b5b5" }}>Performance Metrics</h2>
      <div
        className="low-contrast-button"
        tabIndex={-1}
        onClick={onRefresh}
      >
        <svg width="16" height="16" viewBox="0 0 16 16">
          <path d="M8 0a8 8 0 1 0 8 8A8 8 0 0 0 8 0zm0 14A6 6 0 1 1 14 8a6 6 0 0 1-6 6z" />
        </svg>
      </div>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {metrics.map((metric) => (
          <li key={metric.id} style={{ color: "#9ca3af", backgroundColor: "#d1d5db", margin: "4px 0" }}>
            <span>{metric.name}: </span>
            <span>{metric.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
