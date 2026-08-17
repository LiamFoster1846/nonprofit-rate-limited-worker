import { z } from "zod";

const donorReceipt = z.object({
  type: z.literal("donor_receipt"),
  jobId: z.string().min(1),
  donorEmail: z.string().email(),
  donationCents: z.number().int().positive(),
  donatedAt: z.string().datetime(),
});

const volunteerReminder = z.object({
  type: z.literal("volunteer_reminder"),
  jobId: z.string().min(1),
  volunteerEmail: z.string().email(),
  shiftStartsAt: z.string().datetime(),
  location: z.string().min(1),
});

const campaignReport = z.object({
  type: z.literal("campaign_report"),
  jobId: z.string().min(1),
  campaignId: z.string().min(1),
  periodEndsAt: z.string().datetime(),
});

export const nonprofitJobSchema = z.discriminatedUnion("type", [
  donorReceipt,
  volunteerReminder,
  campaignReport,
]);

export type NonprofitJob = z.infer<typeof nonprofitJobSchema>;

export type DispatchPlan = {
  priority: "urgent" | "normal" | "background";
  action: "send_receipt" | "send_reminder" | "compile_report";
};

export function planDispatch(job: NonprofitJob, now: Date): DispatchPlan {
  if (job.type === "donor_receipt") {
    return { priority: "urgent", action: "send_receipt" };
  }

  if (job.type === "volunteer_reminder") {
    const hoursUntilShift =
      (Date.parse(job.shiftStartsAt) - now.getTime()) / (60 * 60 * 1000);
    return {
      priority: hoursUntilShift <= 24 ? "urgent" : "normal",
      action: "send_reminder",
    };
  }

  return { priority: "background", action: "compile_report" };
}
