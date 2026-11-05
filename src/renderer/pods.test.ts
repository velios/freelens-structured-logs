import { describe, expect, it } from "vitest";
import { mergeByTime, pickPods, podLabel } from "./pods";

const line = (pod: string, kubeletTime: string) => ({ pod, kubeletTime });

describe("podLabel", () => {
  it("drops the group name", () => {
    expect(podLabel("messages-consumer-5c4b6fbd56-h99zm", "messages-consumer-5c4b6fbd56")).toBe("h99zm");
    expect(podLabel("messages-consumer-5c4b6fbd56-h99zm", "messages-consumer")).toBe("5c4b6fbd56-h99zm");
  });

  it("keeps a name outside the group", () => {
    expect(podLabel("other-7d9f8-abcde", "messages-consumer")).toBe("other-7d9f8-abcde");
  });
});

describe("pickPods", () => {
  it("keeps streamed pods and adds new ones up to the limit", () => {
    expect(pickPods(["b", "c"], ["a", "b", "d"], 3)).toEqual(["b", "a", "d"]);
  });

  it("drops gone pods and takes the first ones of a new group", () => {
    expect(pickPods(["x"], ["a", "b", "c"], 2)).toEqual(["a", "b"]);
  });
});

describe("mergeByTime", () => {
  it("sorts the first batch of several pods by kubelet time", () => {
    const merged = mergeByTime(
      [],
      [
        line("a", "2026-10-28T10:00:01.000000000Z"),
        line("a", "2026-10-28T10:00:03.000000000Z"),
        line("b", "2026-10-28T10:00:02.000000000Z"),
        line("b", "2026-10-28T10:00:04.000000000Z"),
      ],
    );

    expect(merged.map((l) => `${l.pod} ${l.kubeletTime.slice(17, 19)}`)).toEqual(["a 01", "b 02", "a 03", "b 04"]);
  });

  it("appends live lines and merges a late batch in place", () => {
    const sorted = [line("a", "2026-10-28T10:00:01.000000000Z"), line("a", "2026-10-28T10:00:03.000000000Z")];
    const appended = mergeByTime(sorted, [line("b", "2026-10-28T10:00:04.000000000Z")]);
    const late = mergeByTime(appended, [line("c", "2026-10-28T10:00:02.000000000Z")]);

    expect(appended.map((l) => l.pod)).toEqual(["a", "a", "b"]);
    expect(late.map((l) => l.pod)).toEqual(["a", "c", "a", "b"]);
  });

  it("keeps the order of equal times and puts lines without time last", () => {
    const merged = mergeByTime(
      [line("a", "2026-10-28T10:00:01.000000000Z")],
      [line("b", ""), line("c", "2026-10-28T10:00:01.000000000Z"), line("d", "2026-10-28T10:00:00.000000000Z")],
    );

    expect(merged.map((l) => l.pod)).toEqual(["d", "a", "c", "b"]);
  });
});
