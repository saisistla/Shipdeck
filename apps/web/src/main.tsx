import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { PipelineBoxType } from "@shipdeck/shared";
import { App } from "./App";
import { StandaloneLogPage } from "./LogViewer";
import { WorkbenchPage } from "./WorkbenchPage";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const logRunId = params.get("view") === "logs" ? params.get("run") : null;
const workbenchRunId = params.get("view") === "workbench" ? params.get("run") : null;
const logStep = (params.get("step") as PipelineBoxType | null) ?? undefined;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {workbenchRunId ? (
      <WorkbenchPage runId={workbenchRunId} role={params.get("role") === "test" ? "test" : "code"} />
    ) : logRunId ? (
      <StandaloneLogPage runId={logRunId} initialStep={logStep} />
    ) : (
      <App />
    )}
  </StrictMode>
);
