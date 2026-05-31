// Typed clients for the installed Convex Components (registered in convex/convex.config.ts).
// Importing these in functions is how we call the components (see docs/13-convex-components.md).
import { ActionRetrier } from "@convex-dev/action-retrier";
import { WorkflowManager } from "@convex-dev/workflow";
import { TableAggregate } from "@convex-dev/aggregate";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

// --- Action Retrier -------------------------------------------------------
// Retries an action with exponential backoff (default 4 attempts). We use it for the
// PDF report action so a transient failure doesn't leave an inspection without its report.
export const retrier = new ActionRetrier(components.actionRetrier);

// --- Workflow -------------------------------------------------------------
// Durable, resumable orchestration for the "inspection completed" pipeline.
export const workflow = new WorkflowManager(components.workflow);

// --- Aggregates -----------------------------------------------------------
// Two aggregates over completed-inspection SCORES, so the dashboard gets O(log n)
// averages / counts / leaderboards instead of collect()+reduce over every inspection.
//
//  - scoreByOrg : namespaced by orgId  -> org-wide average score, # of scored inspections
//  - scoreBySite: namespaced by siteId -> per-site average + ranking ("sites at risk")
//
// Key = the score (0–100); sumValue = the score too, so sum()/count() gives the mean.
type ScoreAggregate = {
  Namespace: string; // orgId / siteId as a string
  Key: number;       // score 0–100
  DataModel: DataModel;
  TableName: "inspections";
};

export const scoreByOrg = new TableAggregate<ScoreAggregate>(
  components.scoreByOrg,
  {
    namespace: (doc) => doc.orgId,
    sortKey: (doc) => doc.score ?? 0,
    sumValue: (doc) => doc.score ?? 0,
  },
);

export const scoreBySite = new TableAggregate<ScoreAggregate>(
  components.scoreBySite,
  {
    namespace: (doc) => (doc.siteId ?? doc.orgId) as string,
    sortKey: (doc) => doc.score ?? 0,
    sumValue: (doc) => doc.score ?? 0,
  },
);
