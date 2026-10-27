export const levels = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR"] as const;

export type Level = (typeof levels)[number];

export interface LogRecord {
  id: number;
  /** kubelet timestamp normalized to 9 fraction digits, so string order equals time order */
  kubeletTime: string;
  /** the log line without the kubelet timestamp */
  raw: string;
  json?: Record<string, unknown>;
  timeMs?: number;
  level?: Level;
  message?: string;
  loggerName?: string;
  stackTrace?: string;
}

const rfc3339 = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

/** Parses RFC3339 with up to nanosecond precision; Date.parse is not guaranteed to accept more than 3 digits. */
export function parseTimestamp(value: string): number | undefined {
  const m = rfc3339.exec(value);
  if (!m) return undefined;
  const ms = Date.parse(`${m[1]}.${(m[2] ?? "").padEnd(3, "0").slice(0, 3)}${m[3]}`);
  return Number.isNaN(ms) ? undefined : ms;
}

/** Pads the fraction to 9 digits; kubelet trims trailing zeros (RFC3339Nano). */
export function normalizeTimestamp(value: string): string | undefined {
  const m = rfc3339.exec(value);
  if (!m || m[3] !== "Z") return undefined;
  return `${m[1]}.${(m[2] ?? "").padEnd(9, "0")}Z`;
}

export function shortLoggerName(name: string): string {
  return name.slice(name.lastIndexOf(".") + 1);
}

/** Splits a kubelet line produced with `timestamps=true` into its timestamp and the original line. */
export function splitKubeletLine(line: string): { kubeletTime: string; raw: string } {
  const space = line.indexOf(" ");
  const kubeletTime = space > 0 ? normalizeTimestamp(line.slice(0, space)) : undefined;
  if (!kubeletTime) return { kubeletTime: "", raw: line };
  return { kubeletTime, raw: line.slice(space + 1) };
}

export function parseRecord(id: number, kubeletTime: string, raw: string): LogRecord {
  const record: LogRecord = { id, kubeletTime, raw, timeMs: kubeletTime ? parseTimestamp(kubeletTime) : undefined };
  if (!raw.startsWith("{")) return record;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return record;
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return record;
  const obj = json as Record<string, unknown>;
  if (typeof obj.message !== "string") return record;

  record.json = obj;
  record.message = obj.message;
  if (typeof obj["@timestamp"] === "string") record.timeMs = parseTimestamp(obj["@timestamp"]) ?? record.timeMs;
  if (typeof obj.level === "string") {
    const level = obj.level.toUpperCase();
    if ((levels as readonly string[]).includes(level)) record.level = level as Level;
  }
  if (typeof obj.logger_name === "string") record.loggerName = obj.logger_name;
  if (typeof obj.stack_trace === "string") record.stackTrace = obj.stack_trace;
  return record;
}

export function isMutedFrame(line: string): boolean {
  return /^\s*at (java\.|clojure\.lang\.)/.test(line);
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}
