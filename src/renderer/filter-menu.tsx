import { clipboard } from "electron";
import { type ReactNode, useEffect, useRef, useState } from "react";

export interface FilterItem {
  key: string;
  on: boolean;
  label: ReactNode;
  after?: ReactNode;
  actions?: ReactNode;
  title?: string;
  className?: string;
}

interface FilterMenuProps {
  label: string;
  width: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placeholder: string;
  items: FilterItem[];
  empty: string;
  footer?: ReactNode;
  onToggle: (key: string) => void;
  onOnly: (key: string) => void;
  onSetMany: (keys: string[], on: boolean, everything: boolean) => void;
}

export const FilterMenu = (props: FilterMenuProps) => {
  const { label, width, open, onOpenChange, placeholder, items, empty, footer } = props;
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, onOpenChange]);

  const needle = query.trim().toLowerCase();
  const shown = needle ? items.filter((item) => item.key.toLowerCase().includes(needle)) : items;
  const allOn = shown.length > 0 && shown.every((item) => item.on);

  return (
    <div
      className="sl-menu"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === "Escape") onOpenChange(false);
      }}
    >
      <button
        type="button"
        className={`sl-button sl-menu-button${open ? " sl-open" : ""}`}
        style={{ width }}
        aria-haspopup="true"
        aria-expanded={open}
        title={label}
        onClick={() => onOpenChange(!open)}
      >
        <span className="sl-menu-label">{label}</span>
        <span className="sl-dimmed">▾</span>
      </button>
      {open ? (
        <div className="sl-panel" role="dialog" aria-label={label}>
          <div className="sl-panel-row">
            <input
              className="sl-input sl-panel-search"
              placeholder={placeholder}
              aria-label={placeholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            <button
              type="button"
              className="sl-link sl-panel-all"
              disabled={shown.length === 0}
              onClick={() =>
                props.onSetMany(
                  shown.map((item) => item.key),
                  !allOn,
                  !needle,
                )
              }
            >
              {allOn ? "выключить все" : "включить все"}
            </button>
          </div>
          <div className="sl-panel-list">
            {shown.map((item) => (
              <div key={item.key} className={`sl-panel-row sl-panel-item${item.className ? ` ${item.className}` : ""}`}>
                <label title={item.title}>
                  <input type="checkbox" checked={item.on} onChange={() => props.onToggle(item.key)} />
                  {item.label}
                </label>
                {item.after}
                <span className="sl-grow" />
                {item.actions}
                <button type="button" className="sl-link" onClick={() => props.onOnly(item.key)}>
                  только
                </button>
              </div>
            ))}
            {shown.length === 0 ? <div className="sl-panel-note">{empty}</div> : null}
          </div>
          {footer ? <div className="sl-panel-note sl-panel-footer">{footer}</div> : null}
        </div>
      ) : null}
    </div>
  );
};

export const CopyButton = ({ text, title }: { text: string; title: string }) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    clipboard.writeText(text);
    setCopied(true);
  };

  return (
    <button
      type="button"
      className={`sl-icon${copied ? " sl-done" : ""}`}
      onClick={copy}
      aria-label={title}
      title={`${title}: ${text}`}
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 8.5l3 3 7-7" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
          <rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.5" />
          <path d="M10.5 5.5V3.5a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2" />
        </svg>
      )}
    </button>
  );
};
