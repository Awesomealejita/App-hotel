import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, MemoryRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import { ToastProvider } from "./components/Toaster";
import DemoBar from "./demo/DemoBar";
import "./index.css";

// En modo demo (mockup autocontenido) no hay URL real que enrutar
const isDemo = import.meta.env.MODE === "demo";
const Router = isDemo ? MemoryRouter : BrowserRouter;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Router>
      <AuthProvider>
        <ToastProvider>
          {isDemo && <DemoBar />}
          <App />
        </ToastProvider>
      </AuthProvider>
    </Router>
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD && !isDemo) {
  navigator.serviceWorker.register("/sw.js");
}
