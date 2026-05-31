// Convex cron jobs — spec §6, DoD #5.
// Registers a daily currency sweep trigger.
// NOTE: The cron is NOT tested directly — call currency.sweep with an explicit
// nowMs in tests (see convex/currency.test.ts).
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Daily sweep trigger at 00:00 UTC.
// Calls the internal fanout action which iterates all orgs and calls sweepInternal.
crons.daily(
  "currency-sweep-daily",
  { hourUTC: 0, minuteUTC: 0 },
  internal.currency.sweepFanout,
);

export default crons;
