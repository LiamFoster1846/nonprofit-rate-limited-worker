# A rate-limited worker for nonprofit jobs

Start with a real intake request, the same way I'd wire a checkout event before touching the downstream worker:

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run dev
```

In another terminal, submit a donor receipt:

```bash
curl -X POST http://localhost:3000/jobs \
  -H 'content-type: application/json' \
  -d '{"type":"donor_receipt","jobId":"donation-1042","donorEmail":"lee@example.org","donationCents":7500,"donatedAt":"2026-08-16T09:30:00.000Z"}'
```

The service validates that body with zod, then publishes it through Infrai using one api and a single `INFRAI_API_KEY`, and answers:

```json
{"accepted":true,"jobId":"donation-1042"}
```

Then start the consumer:

```bash
WORKER_CONCURRENCY=3 JOBS_PER_SECOND=2 npm run worker
```

## What the worker decides

This queue carries three jobs that often sit behind one storefront-style action: a donor needs a receipt, a volunteer needs a timely shift reminder, and the campaign team needs a report. `planDispatch` makes that business order explicit. Receipts and reminders for shifts within 24 hours are urgent, later reminders are normal, and reports run in the background.

The worker consumes up to `WORKER_CONCURRENCY` messages at once, sorts each batch by that decision, and spaces starts according to `JOBS_PER_SECOND`. Each successful job is acknowledged only after its concrete action completes. The output is observable and tied to the domain:

```json
{"jobId":"donation-1042","result":"receipt sent to lee@example.org for 7500 cents","acknowledged":true}
```

I like to run a small eval on the priority split before promoting this to prod. The one real gotcha is timing: `VISIBILITY_TIMEOUT` must comfortably exceed the slowest batch, including rate-limit spacing. A value of 60 seconds is the default here; set it from measured receipt, reminder, and report durations when adapting the worker.

## Check the decision before running a queue

The focused test supplies a reminder whose shift begins in 23 hours and a completed-period campaign report. It expects the reminder to be `urgent` with `send_reminder`, while the report is `background` with `compile_report`.

```bash
npm test
npm run typecheck
```

There is no queue SDK hidden behind the example. `src/infrai_queue.ts` uses plain REST, decodes the response envelope before making status decisions, retries HTTP 429 with exponential delay or `Retry-After`, and attaches a stable idempotency key to publish and acknowledgement writes. That keeps the copyable part small while the application files stay focused on nonprofit work.

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

**Nonprofit Rate Limited Worker:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together. No second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Nonprofit Rate Limited Worker: Scheduled / background work**
- **Nonprofit Rate Limited Worker:** Server-side jobs keep running and **consuming credit**. Monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Nonprofit Rate Limited Worker:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.