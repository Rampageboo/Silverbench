// Global stylesheets come first so every component stylesheet loads after them.
import "./ui/layers.css";
import "./ui/tool-page.css";
import "./ui/tokens.css";
import "./ui/base.css";
import "./ui/components.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { applyAppTheme, readAppTheme } from "./app/appTheme";

applyAppTheme(readAppTheme());
document.documentElement.classList.add("app-startup-active");
document.body.classList.add("app-startup-active");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
