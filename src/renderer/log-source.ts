import { Renderer } from "@freelensapp/extensions";
import { setTimeout as sleep } from "node:timers/promises";
import { splitKubeletLine } from "./parse";

export const INITIAL_TAIL_LINES = 1000;
export const MAX_RECORDS = 10_000;
const MAX_RETRY_DELAY_MS = 30_000;

export interface LogSourceTarget {
  namespace: string;
  pod: string;
  container: string;
  previous: boolean;
}

export interface SourceLine {
  kubeletTime: string;
  raw: string;
}

export type SourceState = "connecting" | "streaming" | "reconnecting" | "loaded" | "error";

export interface LogSourceEvents {
  onLines(lines: SourceLine[]): void;
  onState(state: SourceState, message?: string): void;
}

const createApi = () =>
  new Renderer.K8sApi.KubeJsonApi(
    { serverAddress: `https://127.0.0.1:${location.port}`, apiBase: "/api-kube" },
    { headers: { Host: location.host } },
  );

async function request(target: LogSourceTarget, query: Record<string, string | number | boolean>, signal: AbortSignal) {
  const url = `/api/v1/namespaces/${encodeURIComponent(target.namespace)}/pods/${encodeURIComponent(target.pod)}/log`;
  const res = await createApi().getResponse(
    url,
    { query: { container: target.container, timestamps: true, ...query } },
    { signal },
  );
  if (!res.ok) {
    const text = await res.text();
    let message = text || `HTTP ${res.status}`;
    try {
      message = JSON.parse(text).message ?? message;
    } catch {}
    throw new Error(message);
  }
  return res;
}

/** Truncates a normalized kubelet timestamp to seconds, the precision the API keeps for `sinceTime`. */
const toSinceTime = (kubeletTime: string) => `${kubeletTime.slice(0, 19)}Z`;

/**
 * Streams logs of one container with `follow=true` and reconnects from the last seen kubelet timestamp,
 * or loads the previous run once. Returns a function that aborts everything.
 */
export function openLogSource(target: LogSourceTarget, events: LogSourceEvents): () => void {
  const abort = new AbortController();
  const { signal } = abort;
  const stop = () => abort.abort();
  window.addEventListener("pagehide", stop);
  signal.addEventListener("abort", () => window.removeEventListener("pagehide", stop));

  const report = (state: SourceState, message?: string) => {
    if (!signal.aborted) events.onState(state, message);
  };

  if (target.previous) {
    loadPrevious(target, signal, events.onLines).then(
      () => report("loaded"),
      (error) => report("error", errorMessage(error)),
    );
  } else {
    follow(target, signal, events.onLines, report);
  }

  return stop;
}

async function loadPrevious(target: LogSourceTarget, signal: AbortSignal, onLines: LogSourceEvents["onLines"]) {
  const res = await request(target, { previous: true, tailLines: MAX_RECORDS }, signal);
  const lines = (await res.text()).split("\n").filter(Boolean).map(splitKubeletLine);
  if (!signal.aborted) onLines(lines);
}

async function follow(
  target: LogSourceTarget,
  signal: AbortSignal,
  onLines: LogSourceEvents["onLines"],
  report: (state: SourceState, message?: string) => void,
) {
  // Latest kubelet timestamp and the lines seen within its second: a reconnect with
  // second-precision `sinceTime` repeats that second, and only those repeats are dropped.
  let lastTime = "";
  let recentSecond = "";
  let recent = new Set<string>();
  let replayUntil = "";
  let retryDelay = 500;

  const isNew = ({ kubeletTime, raw }: SourceLine) => {
    if (!kubeletTime) return true;
    const key = `${kubeletTime} ${raw}`;
    if (replayUntil) {
      if (kubeletTime > replayUntil) replayUntil = "";
      else if (recent.has(key)) return false;
    }
    const second = kubeletTime.slice(0, 19);
    if (second > recentSecond) {
      recentSecond = second;
      recent = new Set();
    }
    if (second === recentSecond) recent.add(key);
    if (kubeletTime > lastTime) lastTime = kubeletTime;
    return true;
  };

  let lastError: string | undefined;

  while (!signal.aborted) {
    if (!lastTime && !lastError) report("connecting");
    let received = false;
    const startedAt = Date.now();
    try {
      replayUntil = lastTime;
      // tailLines caps the replay after a long outage; the kubelet applies it before sinceTime.
      const query: Record<string, string | number | boolean> = lastTime
        ? { follow: true, sinceTime: toSinceTime(lastTime), tailLines: MAX_RECORDS }
        : { follow: true, tailLines: INITIAL_TAIL_LINES };
      const res = await request(target, query, signal);
      report("streaming");
      lastError = undefined;
      const decoder = new TextDecoder();
      let rest = "";
      for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
        const parts = (rest + decoder.decode(chunk, { stream: true })).split("\n");
        rest = parts.pop() ?? "";
        const lines = parts.filter(Boolean).map(splitKubeletLine).filter(isNew);
        if (lines.length > 0 && !signal.aborted) {
          received = true;
          onLines(lines);
        }
      }
      // A cut-off last line stays unseen and is fetched again after reconnect.
      report("reconnecting");
    } catch (error) {
      if (signal.aborted) return;
      lastError = errorMessage(error);
      report("error", lastError);
    }
    const healthy = received || (!lastError && Date.now() - startedAt > 10_000);
    retryDelay = healthy ? 1000 : Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS);
    // Rejects with AbortError on abort; the loop condition then ends the stream.
    await sleep(retryDelay, undefined, { signal }).catch(() => {});
  }
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
