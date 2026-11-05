import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LogRow } from "./log-row";
import { type LogGroup, MAX_RECORDS, openLogGroup, type SourceLine, type SourceState } from "./log-source";
import { type Level, type LogRecord, levels, parseRecord } from "./parse";
import {
  type LogsTarget,
  listPods,
  MAX_PODS,
  mergeByTime,
  POD_POLL_MS,
  type PodInfo,
  pickPods,
  podColor,
  podLabel,
  type ResolvedTarget,
  type Scope,
  resolveTarget,
  scopes,
  scopeTitles,
} from "./pods";
import styles from "./styles.css?inline";

export interface LogsViewProps {
  target: LogsTarget;
  onTargetChange: (target: LogsTarget) => void;
}

interface ContainerOption {
  name: string;
  init: boolean;
}

interface PodState {
  state: SourceState;
  message?: string;
}

type Matcher = { test: (raw: string) => boolean; error?: string };

function buildMatcher(search: string, regex: boolean): Matcher {
  if (!search) return { test: () => true };
  if (regex) {
    try {
      const re = new RegExp(search, "i");
      return { test: (raw) => re.test(raw) };
    } catch (error) {
      return { test: () => true, error: (error as Error).message };
    }
  }
  const needle = search.toLowerCase();
  return { test: (raw) => raw.toLowerCase().includes(needle) };
}

function containerOptions(pods: readonly PodInfo[]): ContainerOption[] {
  const options: ContainerOption[] = [];
  for (const init of [true, false]) {
    for (const pod of pods) {
      for (const c of pod.containers) {
        if (c.init === init && !options.some((o) => o.name === c.name)) options.push(c);
      }
    }
  }
  return options;
}

const distanceToBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight;

export const LogsView = ({ target, onTargetChange }: LogsViewProps) => {
  const { namespace, podName } = target;
  const [resolved, setResolved] = useState<ResolvedTarget>();
  const [scope, setScope] = useState<Scope>(target.scope === "replicaset" ? "replicaset" : "pod");
  const [groupPods, setGroupPods] = useState<PodInfo[]>();
  const [listError, setListError] = useState<string>();
  const [streamed, setStreamed] = useState<string[]>([]);
  const [seenPods, setSeenPods] = useState<string[]>([]);
  const [hiddenPods, setHiddenPods] = useState<ReadonlySet<string>>(() => new Set());
  const [container, setContainer] = useState("");
  const [previous, setPrevious] = useState(false);

  const [search, setSearch] = useState("");
  const [regex, setRegex] = useState(false);
  const [enabledLevels, setEnabledLevels] = useState<ReadonlySet<Level>>(() => new Set(levels));
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());

  const [podStates, setPodStates] = useState<Record<string, PodState>>({});
  const [version, setVersion] = useState(0);
  const [paused, setPaused] = useState(false);
  const [newCount, setNewCount] = useState(0);

  const records = useRef<LogRecord[]>([]);
  const nextId = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const dragging = useRef(false);
  const logGroup = useRef<LogGroup>();

  useEffect(() => {
    setResolved(undefined);
    resolveTarget(target).then(setResolved);
  }, [target]);

  const group = scope === "replicaset" ? resolved?.replicaSet : undefined;
  const available = useMemo(() => scopes.filter((s) => s === "pod" || resolved?.replicaSet), [resolved]);
  const scopeOptions = scopes.filter((s) => s === scope || available.includes(s));
  const isGroup = scope !== "pod";
  const previousOn = !isGroup && previous;

  useEffect(() => {
    if (!resolved) return;
    onTargetChange({
      namespace,
      podName,
      scope,
      replicaSet: resolved.replicaSet?.name ?? target.replicaSet,
    });
  }, [resolved, scope]);

  useEffect(() => {
    setGroupPods(undefined);
    setListError(undefined);
    setStreamed([]);
    setSeenPods([]);
    setHiddenPods(new Set());
    if (!group) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const pods = await listPods(namespace, group.selector);
        if (cancelled) return;
        const names = pods.map((p) => p.name);
        const ordered = podName && names.includes(podName) ? [podName, ...names.filter((n) => n !== podName)] : names;
        setGroupPods(pods);
        setListError(undefined);
        setStreamed((prev) => pickPods(prev, ordered));
        setSeenPods((prev) => [...prev, ...names.filter((n) => !prev.includes(n))]);
      } catch (error) {
        if (!cancelled) setListError(`Pods of ${group.name}: ${String(error)}`);
      }
      if (!cancelled) timer = setTimeout(poll, POD_POLL_MS);
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [namespace, podName, group?.name, group?.selector]);

  const pods = isGroup ? groupPods : resolved?.pod ? [resolved.pod] : undefined;
  const containersKey = JSON.stringify(pods ? containerOptions(pods) : null);
  const containers = useMemo<ContainerOption[] | undefined>(() => JSON.parse(containersKey) ?? undefined, [containersKey]);

  useEffect(() => {
    if (!containers || containers.some((c) => c.name === container)) return;
    setContainer(containers.find((c) => !c.init)?.name ?? containers[0]?.name ?? "");
  }, [containers]);

  const podsByName = useMemo(() => new Map((pods ?? []).map((p) => [p.name, p])), [pods]);
  const hasContainer = (name: string) => podsByName.get(name)?.containers.some((c) => c.name === container) ?? false;
  const streamTargets = (isGroup ? streamed : resolved?.pod ? [resolved.pod.name] : []).filter(hasContainer);
  const streamTargetsRef = useRef(streamTargets);
  streamTargetsRef.current = streamTargets;
  const streamKey = streamTargets.join("\n");

  const matcher = useMemo(() => buildMatcher(search, regex), [search, regex]);
  const isVisible = useCallback(
    (record: LogRecord) =>
      (!record.level || enabledLevels.has(record.level)) &&
      !(record.pod && hiddenPods.has(record.pod)) &&
      matcher.test(record.raw),
    [matcher, enabledLevels, hiddenPods],
  );
  const isVisibleRef = useRef(isVisible);
  isVisibleRef.current = isVisible;

  useEffect(() => {
    if (!container) return;
    records.current = [];
    let pending: LogRecord[] = [];
    stick.current = !previousOn;
    setExpanded(new Set());
    setPaused(false);
    setNewCount(0);
    setPodStates({});
    setVersion((v) => v + 1);

    let frame = 0;
    const flush = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      const added = pending;
      pending = [];
      const all = mergeByTime(records.current, added);
      records.current = all.length > MAX_RECORDS ? all.slice(all.length - MAX_RECORDS) : all;
      if (!stick.current) setNewCount((n) => n + added.filter(isVisibleRef.current).length);
      setVersion((v) => v + 1);
    };

    const sources = openLogGroup(
      { namespace, container, previous: previousOn },
      {
        onLines: (pod, lines: SourceLine[]) => {
          for (const line of lines) pending.push({ ...parseRecord(nextId.current++, line.kubeletTime, line.raw), pod });
          if (pending.length >= MAX_RECORDS) flush();
          else if (!frame) frame = requestAnimationFrame(flush);
        },
        onState: (pod, state, message) => setPodStates((prev) => ({ ...prev, [pod]: { state, message } })),
      },
    );
    sources.setPods(streamTargetsRef.current);
    logGroup.current = sources;

    return () => {
      sources.stop();
      logGroup.current = undefined;
      cancelAnimationFrame(frame);
    };
  }, [namespace, scope, container, previousOn]);

  useEffect(() => {
    logGroup.current?.setPods(streamTargetsRef.current);
  }, [streamKey]);

  const visible = useMemo(() => records.current.filter(isVisible), [version, isVisible]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [visible]);

  const pause = () => {
    const el = listRef.current;
    if (previousOn || !stick.current || !el || el.scrollHeight <= el.clientHeight) return;
    stick.current = false;
    setPaused(true);
  };

  const resume = () => {
    stick.current = !previousOn;
    setPaused(false);
    setNewCount(0);
  };

  const onScroll = () => {
    const el = listRef.current;
    if (!el || previousOn) return;
    // Resume only at the very bottom, so a scroll up that starts near it keeps the pause.
    const distance = distanceToBottom(el);
    if (distance < 2) {
      if (!stick.current) resume();
    } else if (dragging.current) {
      pause();
    } else if (stick.current) {
      // Rows rendered by content-visibility changed the height; stay at the bottom.
      el.scrollTop = el.scrollHeight;
    }
  };

  // A drag of the scrollbar is the only scroll input without a wheel or key event.
  const startDrag = () => {
    dragging.current = true;
    window.addEventListener("pointerup", () => (dragging.current = false), { once: true });
  };

  const scrollToBottom = () => {
    resume();
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const toggleExpanded = useCallback((id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const toggleLevel = (level: Level) => {
    setEnabledLevels((prev) => {
      const next = new Set(prev);
      if (!next.delete(level)) next.add(level);
      return next;
    });
  };

  const togglePod = (pod: string) => {
    setHiddenPods((prev) => {
      const next = new Set(prev);
      if (!next.delete(pod)) next.add(pod);
      return next;
    });
  };

  const changeScope = (next: Scope) => {
    if (next !== "pod") setPrevious(false);
    setGroupPods(undefined);
    setStreamed([]);
    setSeenPods([]);
    setScope(next);
  };

  const groupName = scope === "replicaset" ? target.replicaSet : undefined;
  const missingGroup =
    isGroup && resolved && !group ? `${scopeTitles[scope]} ${namespace}/${groupName ?? ""} not found` : undefined;
  const labels = useMemo(
    () => new Map(seenPods.map((name) => [name, group ? podLabel(name, group.name) : name])),
    [seenPods, group?.name],
  );
  const labelWidth = Math.max(0, ...[...labels.values()].map((label) => label.length));

  const podState = podName ? podStates[podName] : undefined;
  const streamingCount = streamTargets.filter((p) => podStates[p]?.state === "streaming").length;
  const status = isGroup
    ? { state: streamingCount === streamTargets.length && streamingCount > 0 ? "streaming" : "connecting", text: `${streamingCount}/${streamTargets.length} streaming` }
    : { state: podState?.state ?? "connecting", text: podState?.state ?? "connecting" };
  const groupPodNames = new Set(groupPods?.map((p) => p.name));

  return (
    <div className="sl-view">
      <style>{styles}</style>
      <div className="sl-toolbar">
        <span className="sl-title">
          {namespace}/{isGroup ? `${group?.name ?? groupName ?? ""}-*` : podName}
        </span>
        {scopeOptions.length > 1 ? (
          <div className="sl-segmented" role="radiogroup" title="Scope">
            {scopeOptions.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={s === scope}
                className={`sl-button${s === scope ? " sl-on" : ""}`}
                onClick={() => changeScope(s)}
              >
                {scopeTitles[s]}
              </button>
            ))}
          </div>
        ) : null}
        {containers && containers.length > 1 ? (
          <select className="sl-input" value={container} onChange={(e) => setContainer(e.target.value)} title="Container">
            {containers.map((c) => (
              <option key={c.name} value={c.name}>
                {c.init ? `init: ${c.name}` : c.name}
              </option>
            ))}
          </select>
        ) : null}
        <label className={`sl-check${isGroup ? " sl-disabled" : ""}`} title={isGroup ? "Only for a single pod" : undefined}>
          <input type="checkbox" checked={previousOn} disabled={isGroup} onChange={(e) => setPrevious(e.target.checked)} />{" "}
          Previous
        </label>
        <span className={`sl-state sl-state-${status.state}`}>{status.text}</span>
      </div>
      <div className="sl-toolbar">
        <input
          className={`sl-input sl-search${matcher.error ? " sl-invalid" : ""}`}
          placeholder="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          title={matcher.error}
        />
        <button
          type="button"
          className={`sl-button sl-chip${regex ? " sl-on" : ""}`}
          aria-pressed={regex}
          onClick={() => setRegex(!regex)}
          title="Regular expression"
        >
          .*
        </button>
        {levels.map((level) => (
          <button
            key={level}
            type="button"
            className={`sl-button sl-chip sl-level-${level.toLowerCase()}${enabledLevels.has(level) ? " sl-on" : ""}`}
            aria-pressed={enabledLevels.has(level)}
            onClick={() => toggleLevel(level)}
          >
            {level}
          </button>
        ))}
        <span className="sl-count">
          {visible.length} / {records.current.length}
        </span>
      </div>
      {isGroup && seenPods.length > 0 ? (
        <div className="sl-toolbar sl-pods">
          {seenPods.map((name) => {
            const gone = !groupPodNames.has(name);
            const state = podStates[name];
            const noContainer = !gone && !hasContainer(name);
            const title = [
              name,
              gone ? "gone" : noContainer ? `no container ${container}` : streamed.includes(name) ? state?.state : `not streamed, over ${MAX_PODS} pods`,
              state?.state === "error" ? state.message : undefined,
            ]
              .filter(Boolean)
              .join("\n");
            return (
              <button
                key={name}
                type="button"
                className={`sl-button sl-chip sl-pod${hiddenPods.has(name) ? "" : " sl-on"}${gone ? " sl-gone" : ""}${state?.state === "error" ? " sl-pod-error" : ""}`}
                style={{ color: podColor(seenPods.indexOf(name)) }}
                aria-pressed={!hiddenPods.has(name)}
                onClick={() => togglePod(name)}
                title={title}
              >
                {labels.get(name)}
                {noContainer ? " —" : ""}
              </button>
            );
          })}
          {groupPods && groupPods.length > MAX_PODS ? (
            <span className="sl-count">
              {streamed.length} из {groupPods.length}
            </span>
          ) : null}
        </div>
      ) : null}
      {previousOn ? <div className="sl-banner">previous container</div> : null}
      {!isGroup && resolved?.podError ? <div className="sl-banner sl-error">{resolved.podError}</div> : null}
      {missingGroup ? <div className="sl-banner sl-error">{missingGroup}</div> : null}
      {listError ? <div className="sl-banner sl-error">{listError}</div> : null}
      {!isGroup && podState?.state === "error" ? <div className="sl-banner sl-error">{podState.message}</div> : null}
      <div
        className="sl-list"
        ref={listRef}
        onScroll={onScroll}
        onWheel={(e) => e.deltaY < 0 && pause()}
        onKeyDown={(e) => ["ArrowUp", "PageUp", "Home"].includes(e.key) && pause()}
        onPointerDown={startDrag}
        tabIndex={0}
        style={isGroup ? ({ "--sl-pod-width": `${labelWidth}ch` } as React.CSSProperties) : undefined}
      >
        {visible.map((record) => (
          <LogRow
            key={record.id}
            record={record}
            expanded={expanded.has(record.id)}
            onToggle={toggleExpanded}
            podLabel={isGroup && record.pod ? labels.get(record.pod) : undefined}
            podColor={isGroup && record.pod ? podColor(seenPods.indexOf(record.pod)) : undefined}
          />
        ))}
      </div>
      {paused ? (
        <button type="button" className="sl-button sl-new" onClick={scrollToBottom}>
          ↓ {newCount} новых
        </button>
      ) : null}
    </div>
  );
};
