import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no element with the ID root.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
