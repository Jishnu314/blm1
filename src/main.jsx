import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import InstallApp from "./components/InstallApp.jsx";
import ErrorCatcher from "./components/ErrorCatcher.jsx";
import "./index.css";
import "./pwa.js";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorCatcher>
      <App />
    </ErrorCatcher>
    <InstallApp />
  </React.StrictMode>
);
