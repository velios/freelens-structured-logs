import { describe, expect, it } from "vitest";
import { groupTitle, initialPods, labelSelector, mergeByTime, pickPods, podLabel } from "./pods";
import { selectAll, selectOnly } from "./selection";

const line = (pod: string, kubeletTime: string) => ({ pod, kubeletTime });

describe("podLabel", () => {
  it("drops the group name", () => {
    expect(podLabel("worker-5c4b6fbd56-h99zm", "worker-5c4b6fbd56")).toBe("h99zm");
    expect(podLabel("worker-5c4b6fbd56-h99zm", "worker")).toBe("5c4b6fbd56-h99zm");
  });

  it("keeps a name outside the group", () => {
    expect(podLabel("other-7d9f8-abcde", "worker")).toBe("other-7d9f8-abcde");
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

describe("groupTitle", () => {
  it("drops the pod template hash", () => {
    expect(groupTitle({ name: "notifier-5fc7c66cd6", selector: "", hash: "5fc7c66cd6" })).toBe("notifier-*");
  });

  it("keeps a name without the hash", () => {
    expect(groupTitle({ name: "notifier-5fc7c66cd6", selector: "" })).toBe("notifier-5fc7c66cd6-*");
    expect(groupTitle({ name: "custom-rs", selector: "", hash: "5fc7c66cd6" })).toBe("custom-rs-*");
  });
});

describe("initialPods", () => {
  it("opens a new tab on its pod and an old ReplicaSet tab on all pods", () => {
    expect(initialPods({ namespace: "ns", podName: "a-1", scope: "pod" })).toEqual(selectOnly(["a-1"]));
    expect(initialPods({ namespace: "ns", podName: "a-1", scope: "replicaset" })).toEqual(selectAll());
  });

  it("restores a saved choice", () => {
    const pods = { mode: "except" as const, names: ["a-2"] };
    expect(initialPods({ namespace: "ns", podName: "a-1", scope: "pod", pods })).toEqual(pods);
  });
});

describe("labelSelector", () => {
  it("keeps match expressions next to match labels", () => {
    expect(
      labelSelector({
        matchLabels: { app: "notifier", "pod-template-hash": "5fc7c66cd6" },
        matchExpressions: [
          { key: "tier", operator: "In", values: ["api", "worker"] },
          { key: "canary", operator: "NotIn", values: ["true"] },
          { key: "team", operator: "Exists" },
          { key: "legacy", operator: "DoesNotExist" },
        ],
      }),
    ).toBe("app=notifier,pod-template-hash=5fc7c66cd6,tier in (api,worker),canary notin (true),team,!legacy");
  });

  it("builds a selector from expressions only", () => {
    expect(labelSelector({ matchExpressions: [{ key: "app", operator: "In", values: ["a"] }] })).toBe("app in (a)");
  });
});
