import React from "react";
import { createRoot } from "react-dom/client";
import AdminApp from "./admin/AdminApp.jsx";
import InstallApp from "./components/InstallApp.jsx";
import "./index.css";
import "./admin.css";
import "./pwa.js";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AdminApp />
    <InstallApp />
  </React.StrictMode>
);
