import { describe, expect, it } from "vitest";
import {
  formatTime,
  isMutedFrame,
  normalizeTimestamp,
  parseRecord,
  parseTimestamp,
  shortLoggerName,
  splitKubeletLine,
} from "./parse";

const logstashLine =
  '{"@timestamp":"2026-10-20T18:42:09.879376854Z","@version":"1","message":"Starting AppKt v1.0.0 using Java 21.0.12.1 with PID 1 (/app.jar started by root in /)","logger_name":"com.example.app.AppKt","thread_name":"main","level":"INFO","level_value":20000,"tags":["COMMONS-LOGGING"]}';

const errorLine =
  '{"@timestamp":"2026-10-20T18:43:00.1Z","message":"boom","logger_name":"com.example.Foo","level":"ERROR","stack_trace":"java.lang.IllegalStateException: boom\\n\\tat com.example.Foo.run(Foo.kt:10)\\n\\tat java.base/java.lang.Thread.run(Thread.java:1583)"}';

describe("parseRecord", () => {
  it("reads Logstash fields", () => {
    const record = parseRecord(1, "2026-10-20T18:42:09.880000000Z", logstashLine);

    expect(record.message).toBe(
      "Starting AppKt v1.0.0 using Java 21.0.12.1 with PID 1 (/app.jar started by root in /)",
    );
    expect(record.level).toBe("INFO");
    expect(record.loggerName).toBe("com.example.app.AppKt");
    expect(record.timeMs).toBe(Date.UTC(2026, 9, 20, 18, 42, 9, 879));
    expect(record.json?.thread_name).toBe("main");
  });

  it("reads stack_trace", () => {
    const record = parseRecord(1, "", errorLine);

    expect(record.level).toBe("ERROR");
    expect(record.stackTrace?.split("\n")).toHaveLength(3);
    expect(record.timeMs).toBe(Date.UTC(2026, 9, 20, 18, 43, 0, 100));
  });

  it("keeps a non-JSON line as is and falls back to kubelet time", () => {
    const record = parseRecord(1, "2026-10-20T18:42:07.721283521Z", 'openjdk version "21.0.12.1" 2026-08-18 LTS');

    expect(record.json).toBeUndefined();
    expect(record.message).toBeUndefined();
    expect(record.raw).toBe('openjdk version "21.0.12.1" 2026-08-18 LTS');
    expect(record.timeMs).toBe(Date.UTC(2026, 9, 20, 18, 42, 7, 721));
  });

  it("treats JSON without message, broken JSON and arrays as plain lines", () => {
    for (const raw of ['{"level":"INFO"}', '{"message":"cut', '["message"]', '{"message":42}']) {
      expect(parseRecord(1, "", raw).json).toBeUndefined();
    }
  });

  it("ignores unknown levels", () => {
    expect(parseRecord(1, "", '{"message":"x","level":"FATAL"}').level).toBeUndefined();
    expect(parseRecord(1, "", '{"message":"x","level":"warn"}').level).toBe("WARN");
  });
});

describe("timestamps", () => {
  it("parses nanoseconds and short fractions", () => {
    expect(parseTimestamp("2026-10-20T18:42:09.879376854Z")).toBe(Date.UTC(2026, 9, 20, 18, 42, 9, 879));
    expect(parseTimestamp("2026-10-20T18:42:09.06266134Z")).toBe(Date.UTC(2026, 9, 20, 18, 42, 9, 62));
    expect(parseTimestamp("2026-10-20T18:42:09Z")).toBe(Date.UTC(2026, 9, 20, 18, 42, 9, 0));
    expect(parseTimestamp("2026-10-20T21:42:09.5+03:00")).toBe(Date.UTC(2026, 9, 20, 18, 42, 9, 500));
    expect(parseTimestamp("yesterday")).toBeUndefined();
  });

  it("normalizes kubelet timestamps to sortable strings", () => {
    expect(normalizeTimestamp("2026-10-20T18:42:47.06266134Z")).toBe("2026-10-20T18:42:47.062661340Z");
    expect(normalizeTimestamp("2026-10-20T18:42:47Z")).toBe("2026-10-20T18:42:47.000000000Z");
  });

  it("splits the kubelet prefix", () => {
    expect(splitKubeletLine("2026-10-20T18:42:47.06266134Z {}")).toEqual({
      kubeletTime: "2026-10-20T18:42:47.062661340Z",
      raw: "{}",
    });
    expect(splitKubeletLine("no timestamp here")).toEqual({ kubeletTime: "", raw: "no timestamp here" });
  });

  it("formats local time with milliseconds", () => {
    const ms = new Date(2026, 9, 20, 7, 5, 3, 9).getTime();

    expect(formatTime(ms)).toBe("07:05:03.009");
  });
});

describe("helpers", () => {
  it("shortens logger names", () => {
    expect(shortLoggerName("com.example.app.AppKt")).toBe("AppKt");
    expect(shortLoggerName("root")).toBe("root");
  });

  it("mutes java and clojure frames", () => {
    expect(isMutedFrame("\tat java.base/java.lang.Thread.run(Thread.java:1583)")).toBe(true);
    expect(isMutedFrame("\tat clojure.lang.AFn.run(AFn.java:22)")).toBe(true);
    expect(isMutedFrame("\tat com.example.Foo.run(Foo.kt:10)")).toBe(false);
  });
});
