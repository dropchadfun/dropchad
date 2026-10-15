/**
 * The two board tabs: `best dropchad` the default, `best
 * token` second, both ranked by people paid. The api's usd board has no tab and a url naming it
 * falls back to the default. The row number reads `7 people`, singular `1 person`.
 */
import { describe, expect, it } from "vitest";

import { BOARD_TABS, tabFromParam } from "@/components/boards/BoardTabs";
import { formatPeople } from "@/lib/format";

describe("board tabs", () => {
  it("are two, best dropchad first", () => {
    expect(BOARD_TABS).toEqual([
      { value: "fed", label: "best dropchad" },
      { value: "project", label: "best token" },
    ]);
  });

  it("read the url and fall back to the default for anything else, dropper included", () => {
    expect(tabFromParam("project")).toBe("project");
    expect(tabFromParam("fed")).toBe("fed");
    expect(tabFromParam("dropper")).toBe("fed");
    expect(tabFromParam(undefined)).toBe("fed");
  });
});

describe("formatPeople", () => {
  it("says people, singular person, with the count formatted", () => {
    expect(formatPeople(7)).toBe("7 people");
    expect(formatPeople(1)).toBe("1 person");
    expect(formatPeople(0)).toBe("0 people");
    expect(formatPeople(12345)).toBe("12,345 people");
  });
});
