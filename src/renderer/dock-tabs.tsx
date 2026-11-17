import { Renderer } from "@freelensapp/extensions";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LogsView } from "./logs-view";
import { initialPods, type LogsTarget } from "./pods";
import { selectOnly } from "./selection";

// Extensions cannot add dock tab kinds (freelensapp/freelens#731), so a structured log tab is a
// native pod logs tab whose content element gets our view on top of the hidden native one.

const contentIdPrefix = "dock-tab-content-for-";

const hostedCss = `
.sl-hosted { position: relative; }
.sl-hosted > :not(.sl-host) { display: none !important; }
.sl-host { position: absolute; inset: 0; }
`;

const hosts = new Map<string, { element: HTMLDivElement; target: LogsTarget }>();
// A new tab is rendered after createPodTab returns, so only tabs that were shown can be closed.
const shown = new Set<string>();
const marker = document.createElement("style");
let observer: MutationObserver | undefined;
let frame = 0;
// localStorage does not survive a restart: the frame origin contains a random port.
let clusterId = "";
let ipc: Renderer.Ipc;
let updateViews = () => {};
let targets: Record<string, LogsTarget> = {};

function saveTargets() {
  void ipc.invoke("save-tabs", clusterId, targets).catch(console.error);
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
  targets[id] = { namespace: pod.getNs(), podName: pod.getName(), pods: selectOnly([pod.getName()]) };
  saveTargets();
  sync();
}

function updateTarget(id: string, target: LogsTarget) {
  if (!targets[id] || JSON.stringify(targets[id]) === JSON.stringify(target)) return;
  targets[id] = target;
  saveTargets();
  sync();
}

function tabTitle(target: LogsTarget) {
  const pods = initialPods(target);
  if (pods.mode === "only" && pods.names.length === 1) {
    return pods.names[0] === target.podName ? undefined : `{ } ${pods.names[0]}`;
  }
  return target.replicaSet ? `{ } ${target.replicaSet}-*` : undefined;
}

function titleCss(id: string, target: LogsTarget) {
  const title = tabTitle(target);
  const selector = `#tab-${id} [class*="title"]`;
  if (!title) return `${selector}::before { content: "{ } "; }`;
  const tab = document.getElementById(`tab-${id}`);
  const fontSize = tab ? getComputedStyle(tab).fontSize : "inherit";
  return `${selector} { font-size: 0; } ${selector}::before { content: ${JSON.stringify(title)}; font-size: ${fontSize}; }`;
}

/** Mounts views for live structured tabs, moves the view into the selected tab, drops closed tabs. */
function sync() {
  frame = 0;
  const dock = document.querySelector(".Dock");
  if (!dock) return;

  let changed = false;
  for (const id of Object.keys(targets)) {
    quietNativeViewer(id);
    const open = document.getElementById(`tab-${id}`) !== null;
    if (open) shown.add(id);
    if (!open && shown.has(id)) {
      shown.delete(id);
      const host = hosts.get(id);
      host?.element.remove();
      hosts.delete(id);
      delete targets[id];
      changed = true;
    } else if (open && !hosts.has(id)) {
      const host = document.createElement("div");
      host.className = "sl-host";
      hosts.set(id, { element: host, target: targets[id] });
      updateViews();
    }
  }
  if (changed) {
    saveTargets();
    updateViews();
  }

  const content = dock.querySelector<HTMLElement>(".tab-content");
  const selectedId = content?.dataset.testid?.slice(contentIdPrefix.length);
  for (const [id, { element: host }] of hosts) {
    if (content && id === selectedId) {
      if (host.parentElement !== content) content.appendChild(host);
    } else if (host.isConnected) {
      host.remove();
    }
  }
  content?.classList.toggle("sl-hosted", selectedId !== undefined && hosts.has(selectedId));

  const markerText = [
    hostedCss,
    ...[...hosts.keys()].map((id) => titleCss(id, targets[id])),
  ].join("\n");
  if (marker.textContent !== markerText) marker.textContent = markerText;
}

/** Starts in a cluster frame only; persistence is handled by the main process. */
export async function startDockTabs(tabsIpc: Renderer.Ipc) {
  clusterId = /^([0-9a-f]{32})\./.exec(location.hostname)?.[1] ?? "";
  if (!clusterId) return;
  ipc = tabsIpc;
  targets = await ipc.invoke("load-tabs", clusterId);
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
  for (const { element: host } of hosts.values()) {
    host.remove();
  }
  hosts.clear();
  shown.clear();
  updateViews();
  marker.remove();
  document.querySelector(".sl-hosted")?.classList.remove("sl-hosted");
}

export function DockTabs() {
  const [, setVersion] = useState(0);
  useEffect(() => {
    updateViews = () => setVersion((value) => value + 1);
    updateViews();
    return () => { updateViews = () => {}; };
  }, []);
  return <>{[...hosts].map(([id, { element: host, target }]) => createPortal(
    <LogsView target={target} onTargetChange={(next) => updateTarget(id, next)} />,
    host,
    id,
  ))}</>;
}
