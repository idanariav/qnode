import { describe, expect, it } from "vitest";
import { parse } from "../src/parser.js";
import { DEFAULT_CATEGORY_FIELDS } from "../src/categories.js";

describe("parser — frontmatter", () => {
  it("extracts Up edges from a Topic list", () => {
    const md = `---
Topic:
  - "[[Learning]]"
  - "[[Cognition]]"
---
body`;
    const { edges } = parse(md, DEFAULT_CATEGORY_FIELDS);
    const ups = edges.filter((e) => e.category === "Up");
    expect(ups).toHaveLength(2);
    expect(ups.map((e) => e.target).sort()).toEqual(["Cognition", "Learning"]);
    expect(ups.every((e) => e.fieldKey === "Topic")).toBe(true);
  });

  it("extracts Up from a Topic scalar", () => {
    const md = `---
Topic: "[[Single]]"
---
`;
    const { edges } = parse(md, DEFAULT_CATEGORY_FIELDS);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.category).toBe("Up");
    expect(edges[0]!.target).toBe("Single");
  });

  it("ignores unknown frontmatter keys", () => {
    const md = `---
Nope: "[[Unknown]]"
---
`;
    const { edges } = parse(md, DEFAULT_CATEGORY_FIELDS);
    expect(edges).toHaveLength(0);
  });
});

describe("parser — inline annotations", () => {
  it("classifies Supports as Right", () => {
    const md = `We see (Supports:: [[Some Claim]]) in action.`;
    const { edges } = parse(md, DEFAULT_CATEGORY_FIELDS);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.category).toBe("Right");
    expect(edges[0]!.fieldKey).toBe("Supports");
    expect(edges[0]!.target).toBe("Some Claim");
  });

  it("classifies Opposes and Weakens as Left", () => {
    const md = `(Opposes:: [[A]]) and (Weakens:: [[B]]).`;
    const { edges } = parse(md, DEFAULT_CATEGORY_FIELDS);
    expect(edges.map((e) => [e.target, e.category]).sort()).toEqual([
      ["A", "Left"],
      ["B", "Left"],
    ]);
  });

  it("handles alias, section, and block refs", () => {
    const md = `See (Related:: [[Target#section|Alias]]) and [[Plain^block|PA]].`;
    const { edges } = parse(md, DEFAULT_CATEGORY_FIELDS);
    expect(edges).toHaveLength(2);
    const related = edges.find((e) => e.category === "Out")!;
    expect(related.target).toBe("Target");
    expect(related.alias).toBe("Alias");
    const plain = edges.find((e) => e.category === "Uncategorized")!;
    expect(plain.target).toBe("Plain");
    expect(plain.alias).toBe("PA");
  });

  it("does not double-count an annotated wikilink as uncategorized", () => {
    const md = `(Supports:: [[X]])`;
    const { edges } = parse(md, DEFAULT_CATEGORY_FIELDS);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.category).toBe("Right");
  });
});

describe("parser — uncategorized", () => {
  it("plain wikilinks become Uncategorized", () => {
    const md = `Free text [[A]] and [[B|b]].`;
    const { edges } = parse(md, DEFAULT_CATEGORY_FIELDS);
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.category === "Uncategorized")).toBe(true);
    expect(edges.find((e) => e.target === "B")?.alias).toBe("b");
  });

  it("unknown inline-field prefix falls back to Uncategorized", () => {
    const md = `(FooBar:: [[Z]])`;
    const { edges } = parse(md, DEFAULT_CATEGORY_FIELDS);
    // The plain-wikilink pass still picks up [[Z]].
    expect(edges).toHaveLength(1);
    expect(edges[0]!.category).toBe("Uncategorized");
    expect(edges[0]!.target).toBe("Z");
  });
});

describe("parser — title", () => {
  it("uses the first H1 as title", () => {
    const md = `# Hello\n\nBody`;
    const { title } = parse(md, DEFAULT_CATEGORY_FIELDS);
    expect(title).toBe("Hello");
  });

  it("falls back to frontmatter title", () => {
    const md = `---
title: "From FM"
---
Body`;
    const { title } = parse(md, DEFAULT_CATEGORY_FIELDS);
    expect(title).toBe("From FM");
  });
});
