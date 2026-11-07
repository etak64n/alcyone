// The browser side of a WebSocket, which the tests open, feed, and drop by hand.

import type { ServerMessage } from "../../shared/protocol.ts";
import type { SocketLike } from "../../src/board/sync.ts";

export class ClientSocket implements SocketLike {
  readyState = 0;
  readonly url: string;
  readonly sent: Record<string, unknown>[] = [];
  pings = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  send(text: string): void {
    if (text === "ping") {
      this.pings += 1;
      return;
    }
    this.sent.push(JSON.parse(text) as Record<string, unknown>);
  }

  close(): void {
    this.readyState = 3;
  }

  /** Opens the connection and delivers a message of the room. */
  receive(message: ServerMessage): void {
    this.readyState = 1;
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  /** The connection breaks, with a close code. */
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code, reason: "" });
  }

  messages(type: string): Record<string, unknown>[] {
    return this.sent.filter((message) => message["type"] === type);
  }
}

/** A factory that keeps every socket that it made, the newest last. */
export function socketFactory(): { create: (url: string) => SocketLike; sockets: ClientSocket[] } {
  const sockets: ClientSocket[] = [];
  return {
    sockets,
    create: (url) => {
      const socket = new ClientSocket(url);
      sockets.push(socket);
      return socket;
    },
  };
}
