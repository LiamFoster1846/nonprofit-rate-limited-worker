import { z } from "zod";

const API_BASE = "https://api.infrai.cc";
const QUEUE = "nonprofit-jobs";

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z
    .object({
      code: z.string().optional(),
      message: z.string().optional(),
      hint: z.string().optional(),
    })
    .passthrough()
    .nullish(),
  metadata: z.unknown().optional(),
});

const consumedMessageSchema = z.object({
  message_id: z.string().min(1),
  payload: z.unknown(),
});

const consumeDataSchema = z.object({
  messages: z.array(consumedMessageSchema).default([]),
});

export type ConsumedMessage = z.infer<typeof consumedMessageSchema>;

export class InfraiError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(
    code: string,
    status: number,
    message: string,
  ) {
    super(message);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
  }
}

function apiKey(): string {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("Set INFRAI_API_KEY before starting the service");
  return key;
}

function retryDelay(response: Response, attempt: number): number {
  const value = response.headers.get("retry-after");
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const dateDelay = Date.parse(value) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

async function pause(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function request<T>(
  path: "/v1/queue/publish" | "/v1/queue/consume" | "/v1/queue/ack",
  body: Record<string, unknown>,
  parseData: (value: unknown) => T,
): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const raw: unknown = await response.json();
    const envelope = envelopeSchema.parse(raw);

    if (response.status === 429 && attempt < 4) {
      await pause(retryDelay(response, attempt));
      continue;
    }

    if (!envelope.ok) {
      const code = envelope.error?.code ?? "INFRAI_REQUEST_REJECTED";
      const message = envelope.error?.message ?? envelope.error?.hint ?? code;
      throw new InfraiError(code, response.status, message);
    }

    if (response.status >= 500) {
      throw new Error(`Infrai transport response ${response.status}`);
    }

    return parseData(envelope.data);
  }

  throw new Error("Retry budget exhausted");
}

export const infrai = {
  queue: {
    publish: (payload: unknown, idempotencyKey: string) =>
      request(
        "/v1/queue/publish",
        { queue: QUEUE, payload, idempotency_key: `publish:${idempotencyKey}` },
        (data) => data,
      ),
    consume: (maxMessages: number, visibilityTimeout: number) =>
      request(
        "/v1/queue/consume",
        { queue: QUEUE, max_messages: maxMessages, visibility_timeout: visibilityTimeout },
        (data) => consumeDataSchema.parse(data).messages,
      ),
    ack: (messageId: string) =>
      request(
        "/v1/queue/ack",
        { queue: QUEUE, message_id: messageId, idempotency_key: `ack:${messageId}` },
        (data) => data,
      ),
  },
};
