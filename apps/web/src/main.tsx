import "@fontsource-variable/fraunces/wght.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
