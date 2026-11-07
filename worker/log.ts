// Writes one JSON object per log line, which Workers Logs indexes by field.

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export function log(level: LogLevel, message: string, requestId: string | null, fields: Record<string, unknown> = {}): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(requestId === null ? {} : { requestId }),
    service: "alcyone",
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === "ERROR") console.error(line);
  else if (level === "WARN") console.warn(line);
  else console.log(line);
}

export function errorFields(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { errorType: error.name, errorMessage: error.message, stackTrace: error.stack ?? null };
  }
  return { errorType: "NonError", errorMessage: String(error) };
}
