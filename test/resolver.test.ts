import { describe, expect, it } from "vitest";
import { buildIndex, parseTarget, resolveTarget } from "../src/resolver.js";

const root = "/vault";
const files = [
  "/vault/Content/Claims/Active learning.md",
  "/vault/Content/Concepts/Learning.md",
  "/vault/Content/Claims/A person is a community.md",
  "/vault/Sources/Books/Atomic Habits.md",
];

describe("parseTarget", () => {
  it("splits path, section, block, alias", () => {
    expect(parseTarget("Folder/Name#Sec^blk|Al")).toEqual({
      path: "Folder/Name",
      section: "Sec",
      block: "blk",
      alias: "Al",
    });
  });
  it("handles bare name", () => {
    expect(parseTarget("Just")).toEqual({ path: "Just", section: null, block: null, alias: null });
  });
});

describe("resolveTarget", () => {
  const idx = buildIndex(files, root);

  it("resolves bare unique basename", () => {
    expect(resolveTarget("Active learning", idx)).toBe("/vault/Content/Claims/Active learning.md");
  });

  it("resolves explicit relative path", () => {
    expect(resolveTarget("Content/Concepts/Learning", idx)).toBe("/vault/Content/Concepts/Learning.md");
  });

  it("is case insensitive on basename", () => {
    expect(resolveTarget("active learning", idx)).toBe("/vault/Content/Claims/Active learning.md");
  });

  it("returns null for missing", () => {
    expect(resolveTarget("Does not exist", idx)).toBeNull();
  });

  it("strips section/block/alias before resolving", () => {
    expect(resolveTarget("Learning#History|alias", idx)).toBe("/vault/Content/Concepts/Learning.md");
  });
});
