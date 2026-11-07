// Errors that map to HTTP responses, and readers for JSON request bodies. The readers
// reject missing, mistyped, and unknown fields instead of guessing, so a client bug
// surfaces as a 400 response with a reason.

import type { ContentfulStatusCode } from "hono/utils/http-status";

export class HttpError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;

  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message: string): HttpError => new HttpError(400, "bad_request", message);
export const notFound = (message: string): HttpError => new HttpError(404, "not_found", message);
export const forbidden = (message: string): HttpError => new HttpError(403, "forbidden", message);

export type JsonObject = Record<string, unknown>;

export async function readJsonObject(request: Request, fields: readonly string[]): Promise<JsonObject> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw badRequest("The request body must be JSON.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest("The request body must be a JSON object.");
  }
  const body = value as JsonObject;
  const unknown = Object.keys(body).filter((key) => !fields.includes(key));
  if (unknown.length > 0) throw badRequest(`The request body has unknown fields: ${unknown.join(", ")}.`);
  return body;
}

interface StringRule {
  min: number;
  max: number;
  trim: boolean;
}

export function readString(body: JsonObject, name: string, rule: StringRule): string {
  if (!(name in body)) throw badRequest(`${name} is required.`);
  const value = body[name];
  if (typeof value !== "string") throw badRequest(`${name} must be a string.`);
  const text = rule.trim ? value.trim() : value;
  if (text.length < rule.min || text.length > rule.max) {
    throw badRequest(`${name} must be ${rule.min} to ${rule.max} characters long.`);
  }
  return text;
}
