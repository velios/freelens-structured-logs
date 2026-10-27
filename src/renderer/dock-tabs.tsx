import { Renderer } from "@freelensapp/extensions";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { render, unmountComponentAtNode } from "react-dom";
import { LogsView } from "./logs-view";

// Extensions cannot add dock tab kinds (freelensapp/freelens#731), so a structured log tab is a
// native pod logs tab whose content element gets our view on top of the hidden native one.

interface TabTarget {
  namespace: string;
  podName: string;
}

const contentIdPrefix = "dock-tab-content-for-";

const hostedCss = `
.sl-hosted { position: relative; }
.sl-hosted > :not(.sl-host) { display: none !important; }
.sl-host { position: absolute; inset: 0; }
`;

const hosts = new Map<string, HTMLDivElement>();
// A new tab is rendered after createPodTab returns, so only tabs that were shown can be closed.
const shown = new Set<string>();
const marker = document.createElement("style");
let observer: MutationObserver | undefined;
let frame = 0;
// localStorage does not survive a restart: the frame origin contains a random port.
let storePath = "";
let targets: Record<string, TabTarget> = {};

function saveTargets() {
  try {
    writeFileSync(storePath, JSON.stringify(targets));
  } catch {}
}

// The hidden native viewer appends a poll every 10 s without a limit. In previous mode it loads
// a finished run once, or fails and stops polling when there is none.
function quietNativeViewer(id: string) {
  const { logTabStore } = Renderer.Component;
  const data = logTabStore.getData(id);
  if (data && !data.showPrevious) logTabStore.setData(id, { ...data, showPrevious: true });
}

export function openLogsTab(pod: Renderer.K8sApi.Pod) {
  const container = pod.getContainers()[0] ?? pod.getInitContainers()[0];
  if (!container) return;
  const id = Renderer.Component.logTabStore.createPodTab({ selectedPod: pod, selectedContainer: container });
  targets[id] = { namespace: pod.getNs(), podName: pod.getName() };
  saveTargets();
  sync();
}

/** Mounts views for live structured tabs, moves the view into the selected tab, drops closed tabs. */
function sync() {
  frame = 0;
  const dock = document.querySelector(".Dock");
  if (!dock) return;

  let changed = false;
  for (const [id, target] of Object.entries(targets)) {
    quietNativeViewer(id);
    const open = document.getElementById(`tab-${id}`) !== null;
    if (open) shown.add(id);
    if (!open && shown.has(id)) {
      shown.delete(id);
      const host = hosts.get(id);
      if (host) unmountComponentAtNode(host);
      host?.remove();
      hosts.delete(id);
      delete targets[id];
      changed = true;
    } else if (open && !hosts.has(id)) {
      const host = document.createElement("div");
      host.className = "sl-host";
      render(<LogsView namespace={target.namespace} podName={target.podName} />, host);
      hosts.set(id, host);
    }
  }
  if (changed) saveTargets();

  const content = dock.querySelector<HTMLElement>(".tab-content");
  const selectedId = content?.dataset.testid?.slice(contentIdPrefix.length);
  for (const [id, host] of hosts) {
    if (content && id === selectedId) {
      if (host.parentElement !== content) content.appendChild(host);
    } else if (host.isConnected) {
      host.remove();
    }
  }
  content?.classList.toggle("sl-hosted", selectedId !== undefined && hosts.has(selectedId));

  const markerText = [
    hostedCss,
    ...[...hosts.keys()].map((id) => `#tab-${id} [class*="title"]::before { content: "{ } "; }`),
  ].join("\n");
  if (marker.textContent !== markerText) marker.textContent = markerText;
}

/** Starts in a cluster frame only; `folder` is the extension's own file folder. */
export function startDockTabs(folder: string) {
  const clusterId = /^([0-9a-f]{32})\./.exec(location.hostname)?.[1];
  if (!clusterId) return;
  storePath = join(folder, `tabs-${clusterId}.json`);
  try {
    targets = JSON.parse(readFileSync(storePath, "utf8"));
  } catch {}
  document.head.appendChild(marker);
  observer = new MutationObserver(() => {
    if (!frame) frame = requestAnimationFrame(sync);
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-testid"] });
  sync();
}

export function stopDockTabs() {
  observer?.disconnect();
  cancelAnimationFrame(frame);
  for (const host of hosts.values()) {
    unmountComponentAtNode(host);
    host.remove();
  }
  hosts.clear();
  marker.remove();
  document.querySelector(".sl-hosted")?.classList.remove("sl-hosted");
}
