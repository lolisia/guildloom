/**
 * HTTP error helpers.
 *
 * Every API failure uses the shared `{ error: { code, message } }` body. Route
 * code throws {@link HttpError}; the app-level error handler renders it.
 */
import type { FastifyReply } from "fastify";

/** An error carrying the HTTP status and machine-readable code to report. */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** Send the standard API error body and return the reply for chaining. */
export function sendApiError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
): FastifyReply {
  return reply.code(status).send({ error: { code, message } });
}
