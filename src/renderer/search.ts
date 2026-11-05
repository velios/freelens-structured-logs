import { formatTime, type LogRecord, shortLoggerName } from "./parse";

export const MATCH_COLORS = 4;

export interface SearchQuery {
  patterns: RegExp[];
  error?: string;
}

export interface SearchField {
  name: string;
  text: string;
  visible: boolean;
}

export interface Mark {
  start: number;
  end: number;
  color: number;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function buildQuery(input: string, regex: boolean): SearchQuery {
  if (!regex) {
    const terms = input.split(/\s+/).filter(Boolean);
    return { patterns: terms.map((term) => new RegExp(escapeRegExp(term), "gi")) };
  }
  if (!input) return { patterns: [] };
  try {
    return { patterns: [new RegExp(input, "gi")] };
  } catch (error) {
    return { patterns: [], error: (error as Error).message };
  }
}

function flatten(value: unknown, path: string, add: (path: string, text: string) => void) {
  if (value === null || value === undefined) return;
  if (typeof value !== "object") {
    add(path, String(value));
    return;
  }
  const array = Array.isArray(value);
  for (const [key, child] of Object.entries(value)) {
    flatten(child, array ? path : path ? `${path}.${key}` : key, add);
  }
}

export function searchFields(record: LogRecord, podLabel?: string): SearchField[] {
  const fields: SearchField[] = [];
  const add = (name: string, text: string | undefined, visible: boolean) => {
    if (text) fields.push({ name, text, visible });
  };
  if (record.timeMs !== undefined) add("time", formatTime(record.timeMs), true);
  add("pod", podLabel, true);
  const json = record.json;
  if (!json) {
    add("raw", record.raw, true);
    return fields;
  }
  add("level", record.level, true);
  add("logger", record.loggerName && shortLoggerName(record.loggerName), true);
  add("message", record.message, true);
  add("error", record.error, true);

  const shown = new Set([json.message === record.message ? "message" : "msg"]);
  if (record.level) shown.add("level");
  if (record.error) shown.add("error");
  flatten(json, "", (path, text) => {
    if (!shown.has(path)) add(path, text, false);
  });
  return fields;
}

const found = (pattern: RegExp, text: string) => text.search(pattern) !== -1;

export function matchesQuery(fields: readonly SearchField[], patterns: readonly RegExp[]): boolean {
  return patterns.every((pattern) => fields.some((field) => found(pattern, field.text)));
}

export function hiddenMatches(fields: readonly SearchField[], patterns: readonly RegExp[]): string[] {
  const names = new Set<string>();
  for (const pattern of patterns) {
    if (fields.some((field) => field.visible && found(pattern, field.text))) continue;
    for (const field of fields) if (!field.visible && found(pattern, field.text)) names.add(field.name);
  }
  return [...names];
}

export function markRanges(text: string, patterns: readonly RegExp[]): Mark[] {
  const marks: Mark[] = [];
  patterns.forEach((pattern, i) => {
    for (const match of text.matchAll(pattern)) {
      if (match[0]) marks.push({ start: match.index, end: match.index + match[0].length, color: i % MATCH_COLORS });
    }
  });
  marks.sort((a, b) => a.start - b.start || b.end - a.end);

  const merged: Mark[] = [];
  for (const mark of marks) {
    const last = merged[merged.length - 1];
    if (!last || mark.start >= last.end) merged.push(mark);
    else if (mark.end > last.end) merged.push({ ...mark, start: last.end });
  }
  return merged;
}
