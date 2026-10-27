import { clipboard } from "electron";
import { memo, useState } from "react";
import { formatTime, isMutedFrame, type LogRecord, shortLoggerName } from "./parse";

interface LogRowProps {
  record: LogRecord;
  expanded: boolean;
  onToggle: (id: number) => void;
}

export const LogRow = memo(({ record, expanded, onToggle }: LogRowProps) => {
  const toggle = () => {
    // Selecting text must not collapse or expand the row.
    if (record.json && !window.getSelection()?.toString()) onToggle(record.id);
  };
  const timestamp = record.json?.["@timestamp"] ?? record.json?.time;
  const fullTime =
    record.timeMs === undefined
      ? undefined
      : `${new Date(record.timeMs).toLocaleString()} (${typeof timestamp === "string" ? timestamp : record.kubeletTime})`;

  return (
    <div className={`sl-record${record.json ? " sl-clickable" : ""}`}>
      <div className={`sl-row sl-level-${record.level?.toLowerCase() ?? "none"}`} onClick={toggle}>
        <span className="sl-time" title={fullTime}>
          {record.timeMs === undefined ? "" : formatTime(record.timeMs)}
        </span>
        {record.json ? (
          <>
            <span className="sl-level">{record.level ?? ""}</span>
            <span className="sl-logger" title={record.loggerName}>
              {record.loggerName ? shortLoggerName(record.loggerName) : ""}
            </span>
            <span className="sl-message">
              {record.message}
              {record.error ? <span className="sl-error">: {record.error}</span> : null}
              {record.stackTrace && !expanded ? <span className="sl-badge">stack_trace</span> : null}
            </span>
          </>
        ) : (
          <span className="sl-raw">{record.raw}</span>
        )}
      </div>
      {expanded && record.json ? <RecordDetails record={record} json={record.json} /> : null}
    </div>
  );
});

const RecordDetails = ({ record, json }: { record: LogRecord; json: Record<string, unknown> }) => {
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
      {record.stackTrace ? (
        <pre className="sl-stack">
          {record.stackTrace.split("\n").map((line, i) => (
            <div key={i} className={isMutedFrame(line) ? "sl-muted" : undefined}>
              {line}
            </div>
          ))}
        </pre>
      ) : null}
      <pre className="sl-json">{JSON.stringify(rest, null, 2)}</pre>
    </div>
  );
};
