// Vitest global setup — fixes deterministic time for retention tests.
//
// convex/retention.test.ts uses NOW = 2030-06-01 as a fixed reference point.
// The mutation handler calls Date.now() internally; without this, tests run
// in ~2026 and the "should succeed after 5 years" cases fail because the
// 2025-era completedAt timestamps are not yet 5 years in the past.
//
// Freezing the clock to 2030-06-01 makes Date.now() return the same epoch
// as the test's NOW constant, so all retention boundary assertions hold.
//
// Other tests that use Date.now() for relative offsets (registers, revisions)
// are unaffected because they compute both the stored value AND the comparison
// relative to the same Date.now() base.
import { vi } from "vitest";

vi.useFakeTimers();
vi.setSystemTime(new Date("2030-06-01T00:00:00.000Z"));
