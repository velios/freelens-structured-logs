import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CopyButton, type FilterItem, FilterMenu } from "./filter-menu";
import { LogRow } from "./log-row";
import { type LogGroup, MAX_RECORDS, openLogGroup, type SourceLine, type SourceState } from "./log-source";
import { formatTime, type Level, type LogRecord, parseRecord, shortLoggerName } from "./parse";
import {
  groupTitle,
  initialPods,
  type LogsTarget,
  getPods,
  listPods,
  MAX_PODS,
  mergeByTime,
  POD_POLL_MS,
  type PodInfo,
  pickPods,
  podColor,
  podLabel,
  type ResolvedTarget,
  resolveTarget,
} from "./pods";
import { isSelected, type Selection, selectAll, selectionLabel, selectOnly, setNames, toggleName } from "./selection";
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

type LevelFilter = Level | "OTHER";

const levelFilters: readonly LevelFilter[] = ["ERROR", "WARN", "INFO", "DEBUG", "TRACE", "OTHER"];

const levelOf = (record: LogRecord): LevelFilter => record.level ?? "OTHER";

type Menu = "pods" | "loggers";

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
        if (c.init === init && !options.some((o) => o.name === c.name)) options.push({ name: c.name, init: c.init });
      }
    }
  }
  return options;
}

const loggerPackage = (name: string) => name.slice(0, Math.max(0, name.lastIndexOf(".")));

const distanceToBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight;

export const LogsView = ({ target, onTargetChange }: LogsViewProps) => {
  const { namespace, podName } = target;
  const [resolved, setResolved] = useState<ResolvedTarget>();
  const [livePods, setLivePods] = useState<PodInfo[]>();
  const [listError, setListError] = useState<string>();
  const [seenPods, setSeenPods] = useState<string[]>([]);
  const [podSelection, setPodSelection] = useState<Selection>(() => initialPods(target));
  const [loggerSelection, setLoggerSelection] = useState<Selection>(selectAll);
  const [previousPod, setPreviousPod] = useState<string>();
  const [menu, setMenu] = useState<Menu>();
  const [container, setContainer] = useState("");

  const [search, setSearch] = useState("");
  const [regex, setRegex] = useState(false);
  const [enabledLevels, setEnabledLevels] = useState<ReadonlySet<LevelFilter>>(() => new Set(levelFilters));
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());

  const [podStates, setPodStates] = useState<Record<string, PodState>>({});
  const [version, setVersion] = useState(0);
  const [paused, setPaused] = useState(false);
  const [newCount, setNewCount] = useState(0);

  const records = useRef<LogRecord[]>([]);
  const pending = useRef<LogRecord[]>([]);
  const nextId = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const dragging = useRef(false);
  const logGroup = useRef<LogGroup>();
  const streamedRef = useRef<string[]>([]);
  const lastTargets = useRef<string[]>([]);

  useEffect(() => {
    setResolved(undefined);
    resolveTarget(target).then(setResolved);
  }, [target]);

  const group = resolved?.replicaSet;
  const previousOn = previousPod !== undefined;

  useEffect(() => {
    if (!resolved) return;
    onTargetChange({
      namespace,
      podName,
      replicaSet: resolved.replicaSet?.name ?? target.replicaSet,
      pods: podSelection,
    });
  }, [resolved, podSelection]);

  useEffect(() => {
    setLivePods(undefined);
    setListError(undefined);
    setSeenPods([]);
    if (!resolved) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const pods = group ? await listPods(namespace, group.selector) : await getPods(namespace, podName);
        if (cancelled) return;
        const names = pods.map((p) => p.name);
        setLivePods(pods);
        setListError(undefined);
        setSeenPods((prev) => [...prev, ...names.filter((n) => !prev.includes(n))]);
      } catch (error) {
        if (!cancelled) setListError(`Pods of ${group?.name ?? podName}: ${String(error)}`);
      }
      if (!cancelled) timer = setTimeout(poll, POD_POLL_MS);
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [namespace, podName, resolved !== undefined, group?.name, group?.selector]);

  const pods = livePods;
  const knownPods = seenPods;
  const containersKey = JSON.stringify(pods ? containerOptions(pods) : null);
  const containers = useMemo<ContainerOption[] | undefined>(() => JSON.parse(containersKey) ?? undefined, [containersKey]);

  useEffect(() => {
    if (!containers?.length || containers.some((c) => c.name === container)) return;
    setContainer(containers.find((c) => !c.init)?.name ?? containers[0]?.name ?? "");
  }, [containers]);

  const podsByName = useMemo(() => new Map((pods ?? []).map((p) => [p.name, p])), [pods]);
  const containerOf = (name: string) => podsByName.get(name)?.containers.find((c) => c.name === container);
  const hasContainer = (name: string) => containerOf(name) !== undefined;
  const liveNames = (pods ?? []).map((p) => p.name);
  const ordered = liveNames.includes(podName) ? [podName, ...liveNames.filter((n) => n !== podName)] : liveNames;
  const wanted = ordered.filter((name) => isSelected(podSelection, name) && hasContainer(name));
  const wantedKey = wanted.join("\n");
  const streamed = useMemo(() => (streamedRef.current = pickPods(streamedRef.current, wanted)), [wantedKey]);
  const streamTargets = previousPod ? [previousPod].filter(hasContainer) : streamed;
  const streamTargetsRef = useRef(streamTargets);
  streamTargetsRef.current = streamTargets;
  const streamKey = streamTargets.join("\n");

  const matcher = useMemo(() => buildMatcher(search, regex), [search, regex]);
  const isVisible = useCallback(
    (record: LogRecord) =>
      enabledLevels.has(levelOf(record)) &&
      (previousOn || !record.pod || isSelected(podSelection, record.pod)) &&
      (!record.loggerName || isSelected(loggerSelection, record.loggerName)) &&
      matcher.test(record.raw),
    [matcher, enabledLevels, podSelection, loggerSelection, previousOn],
  );
  const isVisibleRef = useRef(isVisible);
  isVisibleRef.current = isVisible;

  useEffect(() => {
    if (!container) return;
    records.current = [];
    pending.current = [];
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
      const added = pending.current;
      pending.current = [];
      const all = mergeByTime(records.current, added);
      records.current = all.length > MAX_RECORDS ? all.slice(all.length - MAX_RECORDS) : all;
      if (!stick.current) setNewCount((n) => n + added.filter(isVisibleRef.current).length);
      setVersion((v) => v + 1);
    };

    const sources = openLogGroup(
      { namespace, container, previous: previousOn },
      {
        onLines: (pod, lines: SourceLine[]) => {
          for (const line of lines) {
            pending.current.push({ ...parseRecord(nextId.current++, line.kubeletTime, line.raw), pod });
          }
          if (pending.current.length >= MAX_RECORDS) flush();
          else if (!frame) frame = requestAnimationFrame(flush);
        },
        onState: (pod, state, message) => setPodStates((prev) => ({ ...prev, [pod]: { state, message } })),
      },
    );
    sources.setPods(streamTargetsRef.current);
    lastTargets.current = streamTargetsRef.current;
    logGroup.current = sources;

    return () => {
      sources.stop();
      logGroup.current = undefined;
      cancelAnimationFrame(frame);
    };
  }, [namespace, container, previousPod]);

  useEffect(() => {
    const sources = logGroup.current;
    if (!sources) return;
    const next = streamTargetsRef.current;
    const live = new Set(liveNames);
    const dropped = lastTargets.current.filter((pod) => !next.includes(pod) && live.has(pod));
    if (dropped.length > 0) {
      const keep = (record: LogRecord) => !record.pod || !dropped.includes(record.pod);
      records.current = records.current.filter(keep);
      pending.current = pending.current.filter(keep);
      setVersion((v) => v + 1);
    }
    sources.setPods(next);
    lastTargets.current = next;
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

  const toggleLevel = (level: LevelFilter) => {
    setEnabledLevels((prev) => {
      const next = new Set(prev);
      if (!next.delete(level)) next.add(level);
      return next;
    });
  };
  const allLevelsOn = enabledLevels.size === levelFilters.length;
  const toggleAllLevels = () => setEnabledLevels(allLevelsOn ? new Set() : new Set(levelFilters));

  const choosePods = (next: (prev: Selection) => Selection) => {
    setPreviousPod(undefined);
    setPodSelection(next);
  };

  const openMenu = (name: Menu) => (open: boolean) => setMenu(open ? name : undefined);

  const labels = useMemo(
    () => new Map(knownPods.map((name) => [name, group ? podLabel(name, group.name) : name])),
    [knownPods.join("\n"), group?.name],
  );
  const shortPod = (name: string) => labels.get(name) ?? name;
  const labelWidth = Math.max(0, ...[...labels.values()].map((label) => label.length));

  const loggerNames = useMemo(() => {
    const names = new Set<string>();
    for (const record of records.current) if (record.loggerName) names.add(record.loggerName);
    return [...names].sort(
      (a, b) => shortLoggerName(a).localeCompare(shortLoggerName(b)) || a.localeCompare(b),
    );
  }, [version]);

  const loggerCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (menu !== "loggers") return counts;
    for (const record of records.current) {
      if (!record.loggerName || !enabledLevels.has(levelOf(record))) continue;
      if (!previousOn && record.pod && !isSelected(podSelection, record.pod)) continue;
      counts.set(record.loggerName, (counts.get(record.loggerName) ?? 0) + 1);
    }
    return counts;
  }, [version, menu, enabledLevels, podSelection, previousOn]);

  const groupPodNames = new Set(liveNames);
  const selectedLive = liveNames.filter((name) => isSelected(podSelection, name) && hasContainer(name));
  const podItems: FilterItem[] = knownPods.map((name) => {
    const gone = !groupPodNames.has(name);
    const info = containerOf(name);
    const state = podStates[name];
    const notStreamed = !gone && info && isSelected(podSelection, name) && !streamed.includes(name);
    const note = gone
      ? "пода больше нет, его строки остались"
      : !info
        ? `нет контейнера ${container}`
        : notStreamed
          ? `не подключён: больше ${MAX_PODS} подов`
          : state?.state === "error"
            ? state.message
            : undefined;
    const lastExit = info?.lastExit;
    const exitText = [
      lastExit?.finishedAt ? `завершён в ${formatTime(Date.parse(lastExit.finishedAt))}` : undefined,
      lastExit?.reason,
    ]
      .filter(Boolean)
      .join(", ");
    return {
      key: name,
      on: isSelected(podSelection, name),
      title: note ? `${name}: ${note}` : name,
      className: [gone ? "sl-gone" : "", !gone && !info ? "sl-no-container" : "", state?.state === "error" ? "sl-pod-error" : ""]
        .filter(Boolean)
        .join(" "),
      label: (
        <>
          <span className="sl-dot" style={{ background: podColor(knownPods.indexOf(name)) }} />
          <span className="sl-mono">{shortPod(name)}</span>
        </>
      ),
      after: <CopyButton text={name} title="Скопировать имя пода" />,
      actions:
        !gone && info && info.restarts > 0 ? (
          <button
            type="button"
            className="sl-link"
            title={`Логи ${container} до последнего рестарта (${info.restarts})${exitText ? `: ${exitText}` : ""}`}
            onClick={() => {
              setPreviousPod(name);
              setMenu(undefined);
            }}
          >
            прошлый запуск
          </button>
        ) : undefined,
    };
  });

  const loggerItems: FilterItem[] = loggerNames.map((name) => ({
    key: name,
    on: isSelected(loggerSelection, name),
    title: name,
    label: (
      <>
        <span className="sl-mono sl-strong">{shortLoggerName(name)}</span>
        <span className="sl-mono sl-pkg">{loggerPackage(name)}</span>
      </>
    ),
    actions: <span className="sl-mono sl-num">{loggerCounts.get(name) ?? 0}</span>,
  }));

  const podMenuLabel = previousPod
    ? `Под: ${shortPod(previousPod)} · прошлый`
    : selectionLabel(podSelection, knownPods, { one: "Под", many: "Поды" }, shortPod);
  const loggerMenuLabel = selectionLabel(loggerSelection, loggerNames, { one: "Логгер", many: "Логгеры" }, shortLoggerName);

  const missingGroup =
    resolved && !group && target.replicaSet && !resolved.pod
      ? `ReplicaSet ${namespace}/${target.replicaSet} not found`
      : undefined;
  const single = streamTargets.length === 1 ? podStates[streamTargets[0]] : undefined;
  const streamingCount = streamTargets.filter((p) => podStates[p]?.state === "streaming").length;
  const status =
    streamTargets.length === 1 || !group
      ? { state: single?.state ?? "connecting", text: single?.state ?? "connecting" }
      : {
          state: streamingCount === streamTargets.length && streamingCount > 0 ? "streaming" : "connecting",
          text: `${streamingCount}/${streamTargets.length} streaming`,
        };
  const previousExit = previousPod ? containerOf(previousPod)?.lastExit : undefined;
  const previousText = [
    `Прошлый запуск ${previousPod ? shortPod(previousPod) : ""}`,
    `контейнер ${container}`,
    previousExit?.finishedAt ? `завершён ${formatTime(Date.parse(previousExit.finishedAt))}` : undefined,
    previousExit?.reason,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="sl-view">
      <style>{styles}</style>
      <div className="sl-toolbar">
        <span className="sl-title" title={group?.name ?? podName}>
          <span className="sl-dimmed">{namespace} /</span> {group ? groupTitle(group) : podName}
        </span>
        <FilterMenu
          label={podMenuLabel}
          width={180}
          open={menu === "pods"}
          onOpenChange={openMenu("pods")}
          placeholder="Поиск пода"
          items={podItems}
          empty="Нет подов с таким именем"
          footer={
            selectedLive.length > streamed.length ? `Подключено ${streamed.length} из ${selectedLive.length}` : undefined
          }
          onToggle={(key) => choosePods((prev) => toggleName(prev, key))}
          onOnly={(key) => choosePods(() => selectOnly([key]))}
          onSetMany={(keys, on, everything) => choosePods((prev) => setNames(prev, keys, on, everything))}
        />
        {containers && containers.length > 1 ? (
          <select className="sl-input" value={container} onChange={(e) => setContainer(e.target.value)} title="Container">
            {containers.map((c) => (
              <option key={c.name} value={c.name}>
                {c.init ? `init: ${c.name}` : c.name}
              </option>
            ))}
          </select>
        ) : null}
        <div className="sl-levels" role="group" aria-label="Уровни">
          <button
            type="button"
            className={`sl-button sl-chip sl-level-all${allLevelsOn ? " sl-on" : enabledLevels.size > 0 ? " sl-on sl-part" : ""}`}
            aria-pressed={allLevelsOn}
            onClick={toggleAllLevels}
            title="Включить или выключить все уровни"
          >
            ALL
          </button>
          {levelFilters.map((level) => (
            <button
              key={level}
              type="button"
              className={`sl-button sl-chip sl-level-${level.toLowerCase()}${enabledLevels.has(level) ? " sl-on" : ""}`}
              aria-pressed={enabledLevels.has(level)}
              onClick={() => toggleLevel(level)}
              title={level === "OTHER" ? "Строки без уровня, в том числе не JSON" : undefined}
            >
              {level}
            </button>
          ))}
        </div>
        <span className={`sl-state sl-state-${status.state}`}>{status.text}</span>
      </div>
      {previousPod ? (
        <div className="sl-banner">
          <span>{previousText}</span>
          <button type="button" className="sl-button" onClick={() => setPreviousPod(undefined)}>
            К живым логам
          </button>
        </div>
      ) : null}
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
        <FilterMenu
          label={loggerMenuLabel}
          width={200}
          open={menu === "loggers"}
          onOpenChange={openMenu("loggers")}
          placeholder="Поиск логгера"
          items={loggerItems}
          empty={loggerNames.length ? "Нет логгеров с таким именем" : "В логах пока нет logger_name"}
          footer="Строки без logger_name этот фильтр не скрывает"
          onToggle={(key) => setLoggerSelection((prev) => toggleName(prev, key))}
          onOnly={(key) => setLoggerSelection(selectOnly([key]))}
          onSetMany={(keys, on, everything) => setLoggerSelection((prev) => setNames(prev, keys, on, everything))}
        />
        <span className="sl-count">
          {visible.length} / {records.current.length}
        </span>
      </div>
      {!group && resolved?.podError ? <div className="sl-banner sl-error">{resolved.podError}</div> : null}
      {missingGroup ? <div className="sl-banner sl-error">{missingGroup}</div> : null}
      {listError ? <div className="sl-banner sl-error">{listError}</div> : null}
      {streamTargets.length === 1 && single?.state === "error" ? (
        <div className="sl-banner sl-error">{single.message}</div>
      ) : null}
      <div
        className="sl-list"
        ref={listRef}
        onScroll={onScroll}
        onWheel={(e) => e.deltaY < 0 && pause()}
        onKeyDown={(e) => ["ArrowUp", "PageUp", "Home"].includes(e.key) && pause()}
        onPointerDown={startDrag}
        tabIndex={0}
        style={group ? ({ "--sl-pod-width": `${labelWidth}ch` } as React.CSSProperties) : undefined}
      >
        {visible.map((record) => (
          <LogRow
            key={record.id}
            record={record}
            expanded={expanded.has(record.id)}
            onToggle={toggleExpanded}
            podLabel={group && record.pod ? labels.get(record.pod) : undefined}
            podColor={group && record.pod ? podColor(knownPods.indexOf(record.pod)) : undefined}
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
