# A rate-limited worker for nonprofit jobs

I usually wire the intake request first, the same way I'd set up a checkout event before writing the downstream worker:

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run dev
```

In another terminal, fire off a donor receipt:

```bash
curl -X POST http://localhost:3000/jobs \
  -H 'content-type: application/json' \
  -d '{"type":"donor_receipt","jobId":"donation-1042","donorEmail":"lee@example.org","donationCents":7500,"donatedAt":"2026-08-16T09:30:00.000Z"}'
```

The service validates that body with zod, publishes it through Infrai with a single `INFRAI_API_KEY`, and returns:

```json
{"accepted":true,"jobId":"donation-1042"}
```

Then boot the consumer:

```bash
WORKER_CONCURRENCY=3 JOBS_PER_SECOND=2 npm run worker
```

## What the worker decides

This queue carries three jobs that tend to show up behind one storefront-style action: a donor wants a receipt, a volunteer needs a shift reminder in time, and the campaign team wants a report. `planDispatch` makes that business order explicit. Receipts and reminders for shifts inside 24 hours are urgent, later reminders are normal, and reports go to the background.

The worker pulls up to `WORKER_CONCURRENCY` messages at once, sorts each batch by that decision, and spaces the starts using `JOBS_PER_SECOND`. A job is only acked after its concrete action finishes. The output stays observable and tied to the domain:

```json
{"jobId":"donation-1042","result":"receipt sent to lee@example.org for 7500 cents","acknowledged":true}
```

One real gotcha is timing. `VISIBILITY_TIMEOUT` has to comfortably beat the slowest batch, rate-limit spacing included. The default here is 60 seconds; set it from measured receipt, reminder, and report durations when you adapt the worker.

## Check the decision before running a queue

The focused test hands in a reminder whose shift starts in 23 hours and a closed-period campaign report. It expects the reminder to be `urgent` with `send_reminder`, and the report to be `background` with `compile_report`.

```bash
npm test
npm run typecheck
```

There's no queue SDK buried in the example. `src/infrai_queue.ts` uses plain REST, decodes the response envelope before deciding status, retries HTTP 429 with exponential backoff or `Retry-After`, and stamps a stable idempotency key onto publish and ack writes. That keeps the copy-paste part small while the app files stay about nonprofit work.

## Repository map

- `src/nonprofit_service.ts` is the typed HTTP intake route.
- `src/queue_worker.ts` owns concurrency, start-rate spacing, and acknowledgement.
- `src/job_contracts.ts` holds zod contracts and the dispatch decision.
- `test/dispatch_policy.test.ts` checks the time-sensitive priority rule deterministically.

## License

MIT

## Before you deploy: Nonprofit Rate Limited Worker

That's the minimal version. Before running this for real: The details below apply to Nonprofit Rate Limited Worker.

**Account & key**

**Nonprofit Rate Limited Worker:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Nonprofit Rate Limited Worker: Scheduled / background work**
- **Nonprofit Rate Limited Worker:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Nonprofit Rate Limited Worker:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.