// Runs the Cloudflare CLI (cf) of this project. cf signs in once with
// `cf auth login`, and every command here uses that sign-in and the account in
// `accountId` of alcyone.config.ts, which cloudflare.config.ts passes to cf.
//
// A command that fails in a way that may pass, a lost connection or an answer of 429 or 5xx
// from Cloudflare, runs again after 2, 4, and 8 seconds. A command that creates a resource
// does not run again by itself (json with retry: false): the stack first looks for the
// resource, which Cloudflare may have made before its answer failed (stack/stack.ts).

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isPassingStatus } from "../shared/retry.ts";

/** A cf command that ended with an error. */
export class CfError extends Error {
  readonly args: readonly string[];
  /** What cf printed, which holds the error that Cloudflare answered. */
  readonly output: string;

  /** printed: cf already printed its output on the terminal, so the message leaves it out. */
  constructor(args: readonly string[], output: string, options: { printed?: boolean } = {}) {
    super(`cf ${args.join(" ")} failed.${options.printed === true || output.trim() === "" ? "" : `\n${output.trim()}`}`);
    this.name = "CfError";
    this.args = args;
    this.output = output;
  }

  /** The HTTP status that Cloudflare answered, when cf printed one. */
  get status(): number | null {
    const match = /\b([45]\d\d) [A-Z][A-Za-z ]+/.exec(this.output);
    return match?.[1] === undefined ? null : Number(match[1]);
  }
}

export interface Cf {
  /** Runs a command that prints JSON, and returns the JSON. Without retry: false, a passing failure runs it again. */
  json(args: readonly string[], options?: { retry?: boolean }): unknown;
  /** Runs a command that prints its progress, such as cf deploy, with extra environment variables. A passing failure runs it again. */
  run(args: readonly string[], env?: Record<string, string>): void;
  /** Waits before a command runs again. */
  pause(ms: number): void;
}

/** How many times a command runs in all, and the wait before the second time, which doubles each time. */
export const CF_ATTEMPTS = 4;
export const CF_FIRST_DELAY_MS = 2000;

// Messages of Node and of cf when the connection to Cloudflare failed.
const LOST_CONNECTION = /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network/i;

/** Whether a failure of cf may pass when the command runs again. */
export function isPassingCfError(error: unknown): boolean {
  if (!(error instanceof CfError)) return false;
  const status = error.status;
  return status === null ? LOST_CONNECTION.test(error.output) : isPassingStatus(status);
}

/** The words of a command without its options, which may hold settings, for the lines about attempts. */
function commandOf(args: readonly string[]): string {
  const end = args.findIndex((arg) => arg.startsWith("-"));
  return (end === -1 ? args : args.slice(0, end)).join(" ");
}

/** Runs a command again while it fails in a way that may pass, up to CF_ATTEMPTS times in all. */
export function withRetries<T>(args: readonly string[], command: () => T, pause: (ms: number) => void, log: (line: string) => void): T {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return command();
    } catch (error) {
      if (attempt >= CF_ATTEMPTS || !isPassingCfError(error)) throw error;
      const delay = CF_FIRST_DELAY_MS * 2 ** (attempt - 1);
      const status = error instanceof CfError ? error.status : null;
      log(`cf ${commandOf(args)} failed${status === null ? "" : ` with ${status}`}. Trying again in ${delay / 1000} seconds (attempt ${attempt + 1} of ${CF_ATTEMPTS}).`);
      pause(delay);
    }
  }
}

/** The cf that `pnpm install` put in the project, so every person runs the same version. */
export function projectCf(root: string): Cf {
  const command = join(root, "node_modules", ".bin", "cf");
  if (!existsSync(command)) throw new Error(`${command} does not exist. Run pnpm install first.`);
  const log = (line: string) => console.error(line);
  // Node lets the main thread block on Atomics.wait, which keeps the stack synchronous.
  const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const once = (args: readonly string[]): unknown => {
    const result = spawnSync(command, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0) throw new CfError(args, `${result.stdout}${result.stderr}`);
    return result.stdout.trim() === "" ? null : (JSON.parse(result.stdout) as unknown);
  };
  return {
    json(args, options = {}) {
      return options.retry === false ? once(args) : withRetries(args, () => once(args), pause, log);
    },
    // The output goes to the terminal as well, after the command, and a failure keeps it to tell a passing one.
    run(args, env = {}) {
      withRetries(
        args,
        () => {
          const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: ["inherit", "pipe", "pipe"], env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
          if (result.error !== undefined) throw result.error;
          process.stdout.write(result.stdout);
          process.stderr.write(result.stderr);
          if (result.status !== 0) throw new CfError(args, `${result.stdout}${result.stderr}`, { printed: true });
        },
        pause,
        log,
      );
    },
    pause,
  };
}
