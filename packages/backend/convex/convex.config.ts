// Registers the Convex Components Beacon uses (see docs/13-convex-components.md).
// `npx convex dev` reads this and generates the typed `components` client used in functions.
import { defineApp } from "convex/server";
import actionRetrier from "@convex-dev/action-retrier/convex.config";
import workflow from "@convex-dev/workflow/convex.config";
import aggregate from "@convex-dev/aggregate/convex.config";

const app = defineApp();

// Reliable retries for the PDF report action (heavy Node work that must not silently drop).
app.use(actionRetrier);

// Durable, resumable "inspection completed" pipeline (score → actions → PDF → notify).
app.use(workflow);

// O(log n) dashboard analytics: per-org/site score averages, pass rates, leaderboards.
// Named instances so several aggregates can coexist over the same data.
app.use(aggregate, { name: "scoreByOrg" });
app.use(aggregate, { name: "scoreBySite" });

export default app;
