import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./styles/index.css";

document.documentElement.setAttribute("data-theme", "dark");
document.documentElement.setAttribute("data-codex-window-type", "electron");
document.documentElement.setAttribute("data-codex-os", "win32");
document.documentElement.lang = "zh-CN";

const container = document.getElementById("root");
if (!container) throw new Error("index.html 缺少 #root 容器");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
