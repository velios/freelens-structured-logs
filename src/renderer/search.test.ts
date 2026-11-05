import { describe, expect, it } from "vitest";
import { parseRecord } from "./parse";
import { buildQuery, hiddenMatches, markRanges, matchesQuery, searchFields } from "./search";

const kafkaLine =
  '{"@timestamp":"2026-11-05T10:02:45.123Z","message":"Connection to node -1 (kafka-0.kafka:9092) could not be established.","logger_name":"org.apache.kafka.clients.NetworkClient","thread_name":"kafka-producer-network-thread | producer-1","level":"WARN","level_value":30000,"mdc":{"trace_id":"8f3a01"},"tags":["NET"]}';

const slogLine =
  '{"time":"2026-10-26T16:39:02.124974946Z","level":"WARN","msg":"Processed request POST / — 400","status":400,"error":"ResourceNotFoundException: The resource does not exist"}';

const kafka = parseRecord(1, "2026-11-05T10:02:45.200000000Z", kafkaLine);
const slog = parseRecord(2, "2026-10-26T16:39:02.200000000Z", slogLine);
const plain = parseRecord(3, "", "Picked up JAVA_TOOL_OPTIONS: -Xmx512m");

const matches = (record: typeof kafka, input: string, regex = false) =>
  matchesQuery(searchFields(record), buildQuery(input, regex).patterns);

describe("matchesQuery", () => {
  it("needs every term, in any order and any case", () => {
    expect(matches(kafka, "KAFKA connection")).toBe(true);
    expect(matches(kafka, "established 9092 conn")).toBe(true);
    expect(matches(kafka, "kafka timeout")).toBe(false);
  });

  it("searches values of hidden and nested fields, but not keys", () => {
    expect(matches(kafka, "8f3a01")).toBe(true);
    expect(matches(kafka, "producer-1")).toBe(true);
    expect(matches(kafka, "NET")).toBe(true);
    expect(matches(kafka, "thread_name")).toBe(false);
    expect(matches(kafka, "trace_id")).toBe(false);
  });

  it("searches null and empty values", () => {
    const record = parseRecord(4, "", '{"message":"ok","mdc":{"reason":null},"empty":""}');
    expect(matches(record, "null")).toBe(true);
    expect(matches(record, "^$", true)).toBe(true);
    expect(matches(kafka, "null")).toBe(false);
  });

  it("searches the raw text of a line that is not JSON", () => {
    expect(matches(plain, "xmx512 java_tool")).toBe(true);
    expect(matches(plain, "Xms")).toBe(false);
  });

  it("treats the whole input as one regex in regex mode", () => {
    expect(matches(kafka, "node -\\d \\(kafka", true)).toBe(true);
    expect(matches(slog, "POST / — \\d{3}", true)).toBe(true);
    expect(matches(slog, "POST / — \\d{4}", true)).toBe(false);
  });

  it("matches everything for an empty or broken query", () => {
    expect(matches(kafka, "  ")).toBe(true);
    expect(buildQuery("(", true)).toEqual({ patterns: [], error: expect.any(String) });
  });
});

describe("hiddenMatches", () => {
  const hidden = (record: typeof kafka, input: string) =>
    hiddenMatches(searchFields(record), buildQuery(input, false).patterns);

  it("names the hidden fields that matched", () => {
    expect(hidden(kafka, "8f3a producer")).toEqual(["mdc.trace_id", "thread_name"]);
    expect(hidden(kafka, "apache")).toEqual(["logger_name"]);
  });

  it("reports only terms that are not found in the row itself", () => {
    expect(hidden(kafka, "kafka")).toEqual([]);
    expect(hidden(kafka, "clients connection")).toEqual(["logger_name"]);
  });

  it("does not report fields that are shown in the row", () => {
    expect(hidden(kafka, "connection warn")).toEqual([]);
    expect(hidden(slog, "processed ResourceNotFound")).toEqual([]);
  });
});

describe("markRanges", () => {
  const marks = (text: string, input: string, regex = false) => markRanges(text, buildQuery(input, regex).patterns);

  it("marks every occurrence with the color of its term", () => {
    expect(marks("Kafka to kafka-0.kafka:9092", "kafka 9092")).toEqual([
      { start: 0, end: 5, color: 0 },
      { start: 9, end: 14, color: 0 },
      { start: 17, end: 22, color: 0 },
      { start: 23, end: 27, color: 1 },
    ]);
  });

  it("does not overlap marks of overlapping terms", () => {
    expect(marks("NetworkClient", "work network client")).toEqual([
      { start: 0, end: 7, color: 1 },
      { start: 7, end: 13, color: 2 },
    ]);
    expect(marks("producer", "produ duce")).toEqual([
      { start: 0, end: 5, color: 0 },
      { start: 5, end: 7, color: 1 },
    ]);
  });

  it("cycles four colors and skips empty regex matches", () => {
    expect(marks("a b c d e", "a b c d e").map((m) => m.color)).toEqual([0, 1, 2, 3, 0]);
    expect(marks("xaay", "a*", true)).toEqual([{ start: 1, end: 3, color: 0 }]);
  });
});
