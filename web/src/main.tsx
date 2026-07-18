import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { seedDevToken } from "./api/client";
import "./index.css";

// DEV-ONLY: seed the token from VITE_FILO_TOKEN so `npm run dev` needs no paste.
// A no-op (and dead-code-eliminated) in production builds.
seedDevToken();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
