// Runs an action again after a short wait while it fails in a way that may pass, such as a
// lost connection or a busy server, so that a passing failure does not stop the work. The
// browser, the Worker, and `pnpm stack:deploy` share it. Only actions that may run twice
// without harm run again: reads, and writes that put the same thing in the same place.

export interface RetryOptions {
  /** How many times to try in all, the first time included. */
  attempts: number;
  /** The wait before the second attempt, which doubles before each later one. */
  firstDelayMs: number;
  /** Whether a failure may pass when the action runs again. */
  retryable: (error: unknown) => boolean;
  /** Waits before the next attempt. Tests pass one that does not wait. */
  wait?: (ms: number) => Promise<void>;
}

export async function retry<T>(action: () => Promise<T>, options: RetryOptions): Promise<T> {
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      if (attempt >= options.attempts || !options.retryable(error)) throw error;
      await wait(options.firstDelayMs * 2 ** (attempt - 1));
    }
  }
}

/**
 * Whether an HTTP status says that the same request may succeed later: too many requests, or
 * a failure of the server or of a service behind it.
 */
export function isPassingStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}
