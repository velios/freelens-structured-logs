export interface Selection {
  mode: "except" | "only";
  names: string[];
}

export const selectAll = (): Selection => ({ mode: "except", names: [] });

export const selectOnly = (names: readonly string[]): Selection => ({ mode: "only", names: [...names] });

export function isSelected(selection: Selection, name: string): boolean {
  return selection.names.includes(name) === (selection.mode === "only");
}

export function toggleName(selection: Selection, name: string): Selection {
  const names = selection.names.includes(name)
    ? selection.names.filter((n) => n !== name)
    : [...selection.names, name];
  return { mode: selection.mode, names };
}

export function setNames(selection: Selection, names: readonly string[], on: boolean, everything: boolean): Selection {
  if (everything) return on ? selectAll() : selectOnly([]);
  const listed = (selection.mode === "only") === on;
  const rest = selection.names.filter((n) => !names.includes(n));
  return { mode: selection.mode, names: listed ? [...rest, ...names] : rest };
}

export interface SelectionLabelWords {
  one: string;
  many: string;
}

export function selectionLabel(
  selection: Selection,
  known: readonly string[],
  words: SelectionLabelWords,
  short: (name: string) => string = (name) => name,
): string {
  const on = known.filter((name) => isSelected(selection, name));
  if (on.length === known.length) return `${words.many}: все · ${known.length}`;
  if (on.length === 0) return `${words.many}: ни одного`;
  if (on.length === 1) return `${words.one}: ${short(on[0])}`;
  return `${words.many}: ${on.length} из ${known.length}`;
}
