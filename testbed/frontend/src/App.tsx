import type { ReactElement } from "react";
import { Dashboard } from "./components/Dashboard.js";

export function App(): ReactElement {
  return (
    <div className="app-root">
      <Dashboard />
    </div>
  );
}
