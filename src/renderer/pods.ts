import { Renderer } from "@freelensapp/extensions";
import { type Selection, selectAll, selectOnly } from "./selection";

export const MAX_PODS = 20;
export const POD_POLL_MS = 5000;

export interface LogsTarget {
  namespace: string;
  podName: string;
  scope?: "pod" | "replicaset";
  replicaSet?: string;
  pods?: Selection;
}

export interface LastExit {
  reason?: string;
  finishedAt?: string;
}

export interface ContainerInfo {
  name: string;
  init: boolean;
  restarts: number;
  lastExit?: LastExit;
}

export interface PodInfo {
  name: string;
  containers: ContainerInfo[];
}

export interface Group {
  name: string;
  selector: string;
  hash?: string;
}

export interface ResolvedTarget {
  pod?: PodInfo;
  podError?: string;
  replicaSet?: Group;
}

const toPodInfo = (pod: Renderer.K8sApi.Pod): PodInfo => {
  const statuses = pod.getContainerStatuses(true);
  const info = (name: string, init: boolean): ContainerInfo => {
    const status = statuses.find((s) => s.name === name);
    const terminated = status?.lastState?.terminated;
    return {
      name,
      init,
      restarts: status?.restartCount ?? 0,
      lastExit: terminated ? { reason: terminated.reason, finishedAt: terminated.finishedAt } : undefined,
    };
  };
  return {
    name: pod.getName(),
    containers: [
      ...pod.getInitContainers().map((c) => info(c.name, true)),
      ...pod.getContainers().map((c) => info(c.name, false)),
    ],
  };
};

const controllerName = (object: Renderer.K8sApi.KubeObject | undefined, kind: string) =>
  object?.getOwnerRefs().find((ref) => ref.kind === kind && ref.controller)?.name;

const toGroup = (object: Renderer.K8sApi.ReplicaSet): Group => ({
  name: object.getName(),
  selector: object.getSelectors().join(","),
  hash: object.metadata.labels?.["pod-template-hash"],
});

const getOrUndefined = <T>(promise: Promise<T | null>) => promise.then((v) => v ?? undefined).catch(() => undefined);

export async function resolveTarget(target: LogsTarget): Promise<ResolvedTarget> {
  const { namespace, podName } = target;
  const { podsApi, replicaSetApi } = Renderer.K8sApi;
  const result: ResolvedTarget = {};

  let pod: Renderer.K8sApi.Pod | undefined;
  try {
    pod = (await podsApi.get({ name: podName, namespace })) ?? undefined;
    if (!pod) result.podError = `Pod ${namespace}/${podName} not found`;
  } catch (error) {
    result.podError = String(error);
  }
  if (pod) result.pod = toPodInfo(pod);

  const rsName = controllerName(pod, "ReplicaSet") ?? target.replicaSet;
  const rs = rsName ? await getOrUndefined(replicaSetApi.get({ name: rsName, namespace })) : undefined;
  if (rs) result.replicaSet = toGroup(rs);

  return result;
}

export async function listPods(namespace: string, selector: string): Promise<PodInfo[]> {
  const pods = await Renderer.K8sApi.podsApi.list({ namespace }, { labelSelector: selector });
  return (pods ?? []).map(toPodInfo).sort((a, b) => a.name.localeCompare(b.name));
}

export function groupTitle(group: Group): string {
  const suffix = group.hash ? `-${group.hash}` : "";
  const base = suffix && group.name.endsWith(suffix) ? group.name.slice(0, -suffix.length) : group.name;
  return `${base}-*`;
}

export function initialPods(target: LogsTarget): Selection {
  if (target.pods) return target.pods;
  return target.scope === "replicaset" ? selectAll() : selectOnly([target.podName]);
}

export function podLabel(podName: string, groupName: string): string {
  return podName.startsWith(`${groupName}-`) ? podName.slice(groupName.length + 1) : podName;
}

export function podColor(index: number): string {
  return `hsl(${Math.round((index * 137.508) % 360)} 65% 60%)`;
}

export function pickPods(streamed: readonly string[], available: readonly string[], limit = MAX_PODS): string[] {
  const kept = streamed.filter((name) => available.includes(name));
  const added = available.filter((name) => !kept.includes(name));
  return [...kept, ...added].slice(0, limit);
}

export function mergeByTime<T extends { kubeletTime: string }>(sorted: T[], added: T[]): T[] {
  const key = (item: T) => item.kubeletTime || "￿";
  const batch = added.map((item, index) => ({ item, index }));
  batch.sort((a, b) => (key(a.item) < key(b.item) ? -1 : key(a.item) > key(b.item) ? 1 : a.index - b.index));
  const next = batch.map(({ item }) => item);
  if (next.length === 0) return sorted;
  if (sorted.length === 0 || key(next[0]) >= key(sorted[sorted.length - 1])) return sorted.concat(next);

  const merged: T[] = [];
  let i = 0;
  let j = 0;
  while (i < sorted.length && j < next.length) merged.push(key(next[j]) < key(sorted[i]) ? next[j++] : sorted[i++]);
  return merged.concat(sorted.slice(i), next.slice(j));
}
