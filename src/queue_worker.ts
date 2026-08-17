import { nonprofitJobSchema, planDispatch, type NonprofitJob } from "./job_contracts.js";
import { infrai, type ConsumedMessage } from "./infrai_queue.js";

const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 3);
const jobsPerSecond = Number(process.env.JOBS_PER_SECOND ?? 2);
const visibilityTimeout = Number(process.env.VISIBILITY_TIMEOUT ?? 60);

function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
}

assertPositive("WORKER_CONCURRENCY", concurrency);
assertPositive("JOBS_PER_SECOND", jobsPerSecond);
assertPositive("VISIBILITY_TIMEOUT", visibilityTimeout);

const rank = { urgent: 0, normal: 1, background: 2 } as const;

async function perform(job: NonprofitJob): Promise<string> {
  if (job.type === "donor_receipt") {
    return `receipt sent to ${job.donorEmail} for ${job.donationCents} cents`;
  }
  if (job.type === "volunteer_reminder") {
    return `shift reminder sent to ${job.volunteerEmail} for ${job.location}`;
  }
  return `campaign report compiled for ${job.campaignId}`;
}

async function processMessage(message: ConsumedMessage): Promise<void> {
  const job = nonprofitJobSchema.parse(message.payload);
  const result = await perform(job);
  await infrai.queue.ack(message.message_id);
  console.log(JSON.stringify({ jobId: job.jobId, result, acknowledged: true }));
}

async function runBatch(): Promise<number> {
  const messages = await infrai.queue.consume(concurrency, visibilityTimeout);
  const now = new Date();
  messages.sort((left, right) => {
    const leftPlan = planDispatch(nonprofitJobSchema.parse(left.payload), now);
    const rightPlan = planDispatch(nonprofitJobSchema.parse(right.payload), now);
    return rank[leftPlan.priority] - rank[rightPlan.priority];
  });

  const interval = 1000 / jobsPerSecond;
  await Promise.all(
    messages.map(async (message, index) => {
      await new Promise((resolve) => setTimeout(resolve, index * interval));
      await processMessage(message);
    }),
  );
  return messages.length;
}

async function main(): Promise<void> {
  console.log(`Worker started with concurrency=${concurrency}, rate=${jobsPerSecond}/second`);
  while (true) {
    const processed = await runBatch();
    if (processed === 0) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
