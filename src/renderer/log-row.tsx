import { clipboard } from "electron";
import { Fragment, memo, useState } from "react";
import { formatTime, isMutedFrame, type LogRecord, shortLoggerName } from "./parse";
import { hiddenMatches, MATCH_COLORS, markRanges, type SearchField } from "./search";

interface LogRowProps {
  record: LogRecord;
  expanded: boolean;
  onToggle: (id: number) => void;
  podLabel?: string;
  podColor?: string;
  patterns: readonly RegExp[];
  fields?: readonly SearchField[];
}

const Marked = ({ text, patterns }: { text: string; patterns: readonly RegExp[] }) => {
  const marks = patterns.length ? markRanges(text, patterns) : [];
  if (!marks.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let pos = 0;
  for (const mark of marks) {
    if (mark.start > pos) parts.push(text.slice(pos, mark.start));
    parts.push(
      <mark key={mark.start} className={`sl-mark sl-mark-${mark.color}`}>
        {text.slice(mark.start, mark.end)}
      </mark>,
    );
    pos = mark.end;
  }
  parts.push(text.slice(pos));
  return <>{parts}</>;
};

const JsonLeaf = ({ text, value, patterns }: { text: string; value: string; patterns: readonly RegExp[] }) => {
  const whole = markRanges(text, patterns).length ? -1 : patterns.findIndex((pattern) => value.search(pattern) !== -1);
  if (whole === -1) return <Marked text={text} patterns={patterns} />;
  return <mark className={`sl-mark sl-mark-${whole % MATCH_COLORS}`}>{text}</mark>;
};

const JsonText = ({ value, patterns, indent = "" }: { value: unknown; patterns: readonly RegExp[]; indent?: string }) => {
  if (value === null || typeof value !== "object") {
    const text = JSON.stringify(value);
    if (typeof value !== "string") return <JsonLeaf text={text} value={text} patterns={patterns} />;
    return (
      <>
        "<JsonLeaf text={text.slice(1, -1)} value={value} patterns={patterns} />"
      </>
    );
  }
  const array = Array.isArray(value);
  const entries = Object.entries(value);
  const [open, close] = array ? ["[", "]"] : ["{", "}"];
  if (!entries.length) return <>{open + close}</>;
  const inner = `${indent}  `;
  return (
    <>
      {open}
      {entries.map(([key, child], i) => (
        <Fragment key={key}>
          {`\n${inner}${array ? "" : `${JSON.stringify(key)}: `}`}
          <JsonText value={child} patterns={patterns} indent={inner} />
          {i < entries.length - 1 ? "," : ""}
        </Fragment>
      ))}
      {`\n${indent}${close}`}
    </>
  );
};

export const LogRow = memo(({ record, expanded, onToggle, podLabel, podColor, patterns, fields }: LogRowProps) => {
  const toggle = () => {
    // Selecting text must not collapse or expand the row.
    if (record.json && !window.getSelection()?.toString()) onToggle(record.id);
  };
  const timestamp = record.json?.["@timestamp"] ?? record.json?.time;
  const fullTime =
    record.timeMs === undefined
      ? undefined
      : `${new Date(record.timeMs).toLocaleString()} (${typeof timestamp === "string" ? timestamp : record.kubeletTime})`;
  const hidden = fields && patterns.length ? hiddenMatches(fields, patterns) : [];

  return (
    <div className={`sl-record${record.json ? " sl-clickable" : ""}`} data-id={record.id}>
      <div
        className={`sl-row sl-level-${record.level?.toLowerCase() ?? "none"}${podLabel ? " sl-with-pod" : ""}`}
        onClick={toggle}
      >
        <span className="sl-time" title={fullTime}>
          {record.timeMs === undefined ? "" : <Marked text={formatTime(record.timeMs)} patterns={patterns} />}
        </span>
        {podLabel && record.pod ? (
          <span className="sl-pod-tag" style={{ color: podColor }} title={record.pod}>
            <Marked text={podLabel} patterns={patterns} />
          </span>
        ) : null}
        {record.json ? (
          <>
            <span className="sl-level">{record.level ? <Marked text={record.level} patterns={patterns} /> : ""}</span>
            <span className="sl-logger" title={record.loggerName}>
              {record.loggerName ? <Marked text={shortLoggerName(record.loggerName)} patterns={patterns} /> : ""}
            </span>
            <span className="sl-message">
              <Marked text={record.message ?? ""} patterns={patterns} />
              {record.error ? (
                <span className="sl-error">
                  : <Marked text={record.error} patterns={patterns} />
                </span>
              ) : null}
              {record.stackTrace && !expanded && !hidden.includes("stack_trace") ? (
                <span className="sl-badge">stack_trace</span>
              ) : null}
              {hidden.length ? (
                <span className="sl-badge sl-found" title={`Найдено в скрытых полях: ${hidden.join(", ")}`}>
                  {hidden.length > 3 ? `${hidden.slice(0, 3).join(", ")}, +${hidden.length - 3}` : hidden.join(", ")}
                </span>
              ) : null}
            </span>
          </>
        ) : (
          <span className="sl-raw">
            <Marked text={record.raw} patterns={patterns} />
          </span>
        )}
      </div>
      {expanded && record.json ? (
        <RecordDetails record={record} json={record.json} showPod={!!podLabel} patterns={patterns} />
      ) : null}
    </div>
  );
});

interface RecordDetailsProps {
  record: LogRecord;
  json: Record<string, unknown>;
  showPod: boolean;
  patterns: readonly RegExp[];
}

const RecordDetails = ({ record, json, showPod, patterns }: RecordDetailsProps) => {
  const [copied, setCopied] = useState(false);
  const formatted = JSON.stringify(json, null, 2);
  const { stack_trace: _shownSeparately, ...rest } = json;
  const copy = () => {
    clipboard.writeText(formatted);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="sl-details">
      <button type="button" className="sl-button sl-copy" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
      {showPod && record.pod ? (
        <div className="sl-pod-name">
          pod: <Marked text={record.pod} patterns={patterns} />
        </div>
      ) : null}
      {record.stackTrace ? (
        <pre className="sl-stack">
          {record.stackTrace.split("\n").map((line, i) => (
            <div key={i} className={isMutedFrame(line) ? "sl-muted" : undefined}>
              <Marked text={line} patterns={patterns} />
            </div>
          ))}
        </pre>
      ) : null}
      <pre className="sl-json">
        <JsonText value={rest} patterns={patterns} />
      </pre>
    </div>
  );
};
