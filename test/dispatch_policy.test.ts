import assert from "node:assert/strict";
import test from "node:test";
import { nonprofitJobSchema, planDispatch } from "../src/job_contracts.js";

test("a shift inside 24 hours is urgent while a campaign report stays in the background", () => {
  const now = new Date("2026-08-16T09:00:00.000Z");
  const reminder = nonprofitJobSchema.parse({
    type: "volunteer_reminder",
    jobId: "reminder-42",
    volunteerEmail: "maya@example.org",
    shiftStartsAt: "2026-08-17T08:00:00.000Z",
    location: "Community kitchen",
  });
  const report = nonprofitJobSchema.parse({
    type: "campaign_report",
    jobId: "report-42",
    campaignId: "winter-coats",
    periodEndsAt: "2026-08-15T23:59:59.000Z",
  });

  assert.deepEqual(planDispatch(reminder, now), {
    priority: "urgent",
    action: "send_reminder",
  });
  assert.deepEqual(planDispatch(report, now), {
    priority: "background",
    action: "compile_report",
  });
});
