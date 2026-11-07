// The HTTP API of alcyone, for the pages. A request that may run twice without harm runs
// again after a lost connection or a busy server.

import type { ApiErrorBody, AssetResponse, BoardResponse, ListBoardsResponse, MeResponse } from "../shared/api.ts";
import { isPassingStatus, retry } from "../shared/retry.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

class BusyError extends Error {}

async function request<T>(method: string, path: string, init: { body?: BodyInit; contentType?: string; again: boolean }): Promise<T> {
  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { accept: "application/json" };
    if (init.contentType !== undefined) headers["content-type"] = init.contentType;
    const response = await fetch(path, { method, headers, body: init.body, credentials: "same-origin" });
    if (init.again && isPassingStatus(response.status)) throw new BusyError(`The server answered ${response.status}.`);
    return response;
  };
  let response: Response;
  try {
    response = init.again
      ? await retry(send, { attempts: 3, firstDelayMs: 500, retryable: (error) => error instanceof TypeError || error instanceof BusyError })
      : await send();
  } catch (error) {
    if (error instanceof BusyError) throw new ApiError(503, "busy", "The server is busy. Try again in a moment.");
    // Cloudflare Access sends a browser whose session ended to its sign-in page, which fetch cannot follow.
    throw new ApiError(0, "network", "alcyone could not be reached. If this lasts, reload the page to sign in again.");
  }
  if (response.status === 204) return undefined as T;
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    throw new ApiError(response.status, "unexpected", "The answer was not from alcyone. Reload the page to sign in again.");
  }
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    const error = (body as Partial<ApiErrorBody>).error;
    throw new ApiError(response.status, error?.code ?? "error", error?.message ?? `The request failed with ${response.status}.`);
  }
  return body as T;
}

const json = (value: unknown) => ({ body: JSON.stringify(value), contentType: "application/json" });

export const api = {
  getMe: () => request<MeResponse>("GET", "/api/me", { again: true }),
  listBoards: () => request<ListBoardsResponse>("GET", "/api/boards", { again: true }),
  // A new board is not made twice: a failed create shows its error instead of trying again.
  createBoard: (name: string) => request<BoardResponse>("POST", "/api/boards", { ...json({ name }), again: false }),
  getBoard: (id: string) => request<BoardResponse>("GET", `/api/boards/${id}`, { again: true }),
  renameBoard: (id: string, name: string) => request<BoardResponse>("PATCH", `/api/boards/${id}`, { ...json({ name }), again: true }),
  deleteBoard: (id: string) => request<void>("DELETE", `/api/boards/${id}`, { again: true }),
  uploadAsset: (boardId: string, file: File) =>
    request<AssetResponse>("POST", `/api/boards/${boardId}/assets`, { body: file, contentType: file.type, again: false }),
};

export function assetUrl(boardId: string, assetId: string): string {
  return `/api/boards/${boardId}/assets/${assetId}`;
}

export function socketUrl(boardId: string): string {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}/api/boards/${boardId}/socket`;
}
