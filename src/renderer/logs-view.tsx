import { Renderer } from "@freelensapp/extensions";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LogRow } from "./log-row";
import { MAX_RECORDS, openLogSource, type SourceLine, type SourceState } from "./log-source";
import { type Level, type LogRecord, levels, parseRecord } from "./parse";
import styles from "./styles.css?inline";

export interface LogsViewProps {
  namespace: string;
  podName: string;
}

interface ContainerOption {
  name: string;
  init: boolean;
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

const distanceToBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight;

export const LogsView = ({ namespace, podName }: LogsViewProps) => {
  const [containers, setContainers] = useState<ContainerOption[]>();
  const [podError, setPodError] = useState<string>();
  const [container, setContainer] = useState("");
  const [previous, setPrevious] = useState(false);

  const [search, setSearch] = useState("");
  const [regex, setRegex] = useState(false);
  const [enabledLevels, setEnabledLevels] = useState<ReadonlySet<Level>>(() => new Set(levels));
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());

  const [state, setState] = useState<{ state: SourceState; message?: string }>({ state: "connecting" });
  const [version, setVersion] = useState(0);
  const [paused, setPaused] = useState(false);
  const [newCount, setNewCount] = useState(0);

  const records = useRef<LogRecord[]>([]);
  const nextId = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const dragging = useRef(false);

  const matcher = useMemo(() => buildMatcher(search, regex), [search, regex]);
  const isVisible = useCallback(
    (record: LogRecord) => (!record.level || enabledLevels.has(record.level)) && matcher.test(record.raw),
    [matcher, enabledLevels],
  );
  const isVisibleRef = useRef(isVisible);
  isVisibleRef.current = isVisible;

  useEffect(() => {
    setContainers(undefined);
    setContainer("");
    setPodError(undefined);
    Renderer.K8sApi.podsApi.get({ name: podName, namespace }).then(
      (pod) => {
        if (!pod) return setPodError(`Pod ${namespace}/${podName} not found`);
        const options = [
          ...pod.getInitContainers().map((c) => ({ name: c.name, init: true })),
          ...pod.getContainers().map((c) => ({ name: c.name, init: false })),
        ];
        setContainers(options);
        setContainer(options.find((c) => !c.init)?.name ?? options[0]?.name ?? "");
      },
      (error) => setPodError(String(error)),
    );
  }, [namespace, podName]);

  useEffect(() => {
    if (!container) return;
    records.current = [];
    let pending: SourceLine[] = [];
    stick.current = !previous;
    setExpanded(new Set());
    setPaused(false);
    setNewCount(0);
    setVersion((v) => v + 1);
    setState({ state: "connecting" });

    let frame = 0;
    const flush = () => {
      frame = 0;
      const added = pending.map((line) => parseRecord(nextId.current++, line.kubeletTime, line.raw));
      pending = [];
      const all = records.current.concat(added);
      records.current = all.length > MAX_RECORDS ? all.slice(all.length - MAX_RECORDS) : all;
      if (!stick.current) setNewCount((n) => n + added.filter(isVisibleRef.current).length);
      setVersion((v) => v + 1);
    };

    const stop = openLogSource(
      { namespace, pod: podName, container, previous },
      {
        onLines: (lines) => {
          pending.push(...lines);
          if (pending.length > MAX_RECORDS) pending.splice(0, pending.length - MAX_RECORDS);
          if (!frame) frame = requestAnimationFrame(flush);
        },
        onState: (state, message) => setState({ state, message }),
      },
    );

    return () => {
      stop();
      cancelAnimationFrame(frame);
    };
  }, [namespace, podName, container, previous]);

  const visible = useMemo(() => records.current.filter(isVisible), [version, isVisible]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [visible]);

  const pause = () => {
    const el = listRef.current;
    if (previous || !stick.current || !el || el.scrollHeight <= el.clientHeight) return;
    stick.current = false;
    setPaused(true);
  };

  const resume = () => {
    stick.current = !previous;
    setPaused(false);
    setNewCount(0);
  };

  const onScroll = () => {
    const el = listRef.current;
    if (!el || previous) return;
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

  const backToPod = (event: React.MouseEvent) => {
    // The pod drawer closes on a window click that started outside of it, including this one.
    event.stopPropagation();
    const { navigate, getDetailsUrl } = Renderer.Navigation;
    navigate(`/pods${getDetailsUrl(`/api/v1/namespaces/${namespace}/pods/${podName}`, true, false)}`);
  };

  return (
    <div className="sl-view">
      <style>{styles}</style>
      <div className="sl-toolbar">
        <button type="button" className="sl-button" onClick={backToPod} title="Back to the pod">
          ← Pod
        </button>
        <span className="sl-title">
          {namespace}/{podName}
        </span>
        <select
          className="sl-input"
          value={container}
          onChange={(e) => setContainer(e.target.value)}
          disabled={!containers}
          title="Container"
        >
          {containers?.map((c) => (
            <option key={c.name} value={c.name}>
              {c.init ? `init: ${c.name}` : c.name}
            </option>
          ))}
        </select>
        <label className="sl-check">
          <input type="checkbox" checked={previous} onChange={(e) => setPrevious(e.target.checked)} /> Previous
        </label>
        <span className={`sl-state sl-state-${state.state}`}>{state.state}</span>
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
      {previous ? <div className="sl-banner">previous container</div> : null}
      {podError ? <div className="sl-banner sl-error">{podError}</div> : null}
      {state.state === "error" ? <div className="sl-banner sl-error">{state.message}</div> : null}
      <div
        className="sl-list"
        ref={listRef}
        onScroll={onScroll}
        onWheel={(e) => e.deltaY < 0 && pause()}
        onKeyDown={(e) => ["ArrowUp", "PageUp", "Home"].includes(e.key) && pause()}
        onPointerDown={startDrag}
        tabIndex={0}
      >
        {visible.map((record) => (
          <LogRow key={record.id} record={record} expanded={expanded.has(record.id)} onToggle={toggleExpanded} />
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
