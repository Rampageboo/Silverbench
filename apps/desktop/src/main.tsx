import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import "../../../web/styles.css";
import "./styles.css";

document.documentElement.setAttribute("data-theme", "dark");
document.documentElement.classList.add("app-startup-active");
document.body.classList.add("app-startup-active");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
