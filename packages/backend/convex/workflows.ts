// Durable "inspection completed" pipeline (Convex Workflow component).
// Started from inspections.complete; survives restarts/deploys and runs each step
// exactly once. Today it generates the PDF report (retried) and finalizes; new
// side-effects (notify site manager, push to analytics rollup) become extra steps.
import { v } from "convex/values";
import { workflow } from "./components";
import { internal } from "./_generated/api";

export const inspectionCompleted = workflow.define({
  args: { inspectionId: v.id("inspections") },
  handler: async (step, { inspectionId }): Promise<void> => {
    // Step 1 — render + store the PDF report. `retry: true` uses the workflow's
    // built-in exponential backoff so a transient Node/storage error self-heals.
    await step.runAction(
      internal.reports.generateInternal,
      { inspectionId },
      { retry: true },
    );

    // Step 2 — finalize (audit that the pipeline finished). Exactly-once.
    await step.runMutation(internal.reportData.markPipelineDone, { inspectionId });

    // Future steps slot in here with zero changes elsewhere, e.g.:
    //   await step.runAction(internal.notify.emailSiteManager, { inspectionId });
  },
});
