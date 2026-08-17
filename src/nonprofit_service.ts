import { createServer, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { InfraiError, infrai } from "./infrai_queue.js";
import { nonprofitJobSchema } from "./job_contracts.js";

const port = Number(process.env.PORT ?? 3000);

function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/jobs") {
    reply(response, 404, { error: "Route not found" });
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const job = nonprofitJobSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));

    await infrai.queue.publish(job, job.jobId);
    reply(response, 202, { accepted: true, jobId: job.jobId });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      reply(response, 400, { error: "Request body is not a valid nonprofit job" });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      reply(response, status, { error: error.code, message: error.message });
      return;
    }
    reply(response, 500, { error: "Unable to accept job" });
  }
}).listen(port, () => {
  console.log(`Nonprofit job intake listening on http://localhost:${port}`);
});
