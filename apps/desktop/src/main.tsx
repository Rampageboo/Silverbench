import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { applyAppTheme, readAppTheme } from "./app/appTheme";
import "./theme.css";
import "./workbench-shared.css";
import "./styles.css";

applyAppTheme(readAppTheme());
document.documentElement.classList.add("app-startup-active");
document.body.classList.add("app-startup-active");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
