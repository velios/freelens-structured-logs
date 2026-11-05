import { describe, expect, it } from "vitest";
import { isSelected, selectAll, selectionLabel, selectOnly, setNames, toggleName } from "./selection";

const words = { one: "Под", many: "Поды" };
const pods = ["9rdw8", "j2nht", "x7kq2"];

describe("selection", () => {
  it("takes later names when all are on, keeps them out after only", () => {
    expect(isSelected(selectAll(), "new")).toBe(true);
    expect(isSelected(selectOnly(["9rdw8"]), "new")).toBe(false);
  });

  it("toggles one name in both modes", () => {
    const off = toggleName(selectAll(), "j2nht");
    expect(pods.filter((p) => isSelected(off, p))).toEqual(["9rdw8", "x7kq2"]);
    expect(pods.filter((p) => isSelected(toggleName(off, "j2nht"), p))).toEqual(pods);

    const on = toggleName(selectOnly(["9rdw8"]), "x7kq2");
    expect(pods.filter((p) => isSelected(on, p))).toEqual(["9rdw8", "x7kq2"]);
  });

  it("turns found names on and off without touching the rest", () => {
    const off = setNames(selectAll(), ["9rdw8", "j2nht"], false, false);
    expect(pods.filter((p) => isSelected(off, p))).toEqual(["x7kq2"]);
    const on = setNames(selectOnly(["x7kq2"]), ["j2nht"], true, false);
    expect(pods.filter((p) => isSelected(on, p))).toEqual(["j2nht", "x7kq2"]);
  });

  it("switches everything on or off when the whole list is given", () => {
    expect(setNames(selectOnly(["9rdw8"]), pods, true, true)).toEqual(selectAll());
    expect(setNames(selectAll(), pods, false, true)).toEqual(selectOnly([]));
  });
});

describe("selectionLabel", () => {
  it("names all, none, one or a count", () => {
    expect(selectionLabel(selectAll(), pods, words)).toBe("Поды: все · 3");
    expect(selectionLabel(selectOnly([]), pods, words)).toBe("Поды: ни одного");
    expect(selectionLabel(selectOnly(["j2nht"]), pods, words)).toBe("Под: j2nht");
    expect(selectionLabel(toggleName(selectAll(), "j2nht"), pods, words)).toBe("Поды: 2 из 3");
  });

  it("shortens the single name", () => {
    const label = selectionLabel(selectOnly(["com.example.mail.SendWorker"]), ["com.example.mail.SendWorker", "a.B"], {
      one: "Логгер",
      many: "Логгеры",
    }, (name) => name.slice(name.lastIndexOf(".") + 1));
    expect(label).toBe("Логгер: SendWorker");
  });
});
