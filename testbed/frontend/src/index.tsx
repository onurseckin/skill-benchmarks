import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Frontend root element is missing");
}

const root = createRoot(rootElement);
root.render(<App />);
