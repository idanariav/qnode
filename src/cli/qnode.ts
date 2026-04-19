/**
 * qnode CLI entry point.
 */

import { resolve } from "path";
import {
  addCollection,
  effectiveCategoryFields,
  getCollection,
  getConfigPath,
  globalCategoryFields,
  isValidCollectionName,
  listCollections,
  removeCollection,
  renameCollection,
  resetCategoryFields,
  setCategoryFields,
} from "../collections.js";
import { Store } from "../store.js";
import { indexCollection } from "../indexer.js";
import {
  distance as graphDistance,
  findByDistance as graphFindByDistance,
  getNodeDetail,
  neighbors as graphNeighbors,
  path as graphPath,
  resolveFileArg,
  siblings as graphSiblings,
} from "../graph.js";
import { ALL_CATEGORIES, isCategory, type Category, type CategoryFields } from "../categories.js";

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (a.startsWith("-") && a.length > 1) {
      const key = a.slice(1);
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function flagStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function flagNum(v: unknown, fallback: number): number {
  if (typeof v === "string") {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}
function flagCategory(v: unknown): Category | undefined {
  const s = flagStr(v);
  if (!s) return undefined;
  if (!isCategory(s)) {
    console.error(`invalid --category: ${s} (allowed: ${ALL_CATEGORIES.join(", ")})`);
    process.exit(2);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

const FIELD_KEYS = [
  "up-frontmatter",
  "down-frontmatter",
  "right-inline",
  "left-inline",
  "in-inline",
  "out-inline",
] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

function fieldKeyToCategoryFields(key: FieldKey, values: string[]): Partial<CategoryFields> {
  switch (key) {
    case "up-frontmatter": return { up_frontmatter: values };
    case "down-frontmatter": return { down_frontmatter: values };
    case "right-inline": return { right_inline: values };
    case "left-inline": return { left_inline: values };
    case "in-inline": return { in_inline: values };
    case "out-inline": return { out_inline: values };
  }
}

function cmdHelp(): void {
  console.log(`qnode - Link-graph indexing for markdown vaults

Commands:
  collection add <path> --name <n> [--pattern <glob>] [--ignore <glob>] [--vault-root <path>]
  collection list
  collection remove <name>
  collection rename <old> <new>

  fields get   [--collection <n>]
  fields set   <field> <val,val,...> [--collection <n>]
  fields reset [--collection <n>]
  (fields: ${FIELD_KEYS.join(", ")})

  index   [--collection <n>]                           Walk + upsert nodes and edges
  status  [--collection <n>]                           Counts by category

  get              <file>                                     Node + all incoming/outgoing edges
  neighbors        <file> [--category <cat>] [--direction out|in|both] [--json]
  siblings         <file> [--shared-min N] [--json]
  distance         <a> <b>  [--max N] [--include-external] [--json]
  path             <a> <b>  [--max N] [--include-external] [--json]
  find-by-distance <file> [--max-distance N] [--file-type <tag>] [--include-existing] [--include-external] [--json]

  mcp                                                  Start stdio MCP server

Config: ${getConfigPath()}
Categories: ${ALL_CATEGORIES.join(", ")}
`);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdFields(args: ParsedArgs): void {
  const sub = args.positional[0];
  const collection = flagStr(args.flags.collection);

  switch (sub) {
    case "get": {
      const fields = collection ? effectiveCategoryFields(collection) : globalCategoryFields();
      const scope = collection ? `collection '${collection}'` : "global";
      console.log(`# Category fields (${scope})`);
      for (const key of FIELD_KEYS) {
        const cfKey = key.replace(/-/g, "_") as keyof CategoryFields;
        console.log(`  ${key.padEnd(18)} ${(fields[cfKey] as string[]).join(", ")}`);
      }
      break;
    }
    case "set": {
      const rawKey = args.positional[1];
      const rawValues = args.positional[2];
      if (!rawKey || !rawValues) {
        console.error(`usage: qnode fields set <field> <val,val,...> [--collection <n>]\nfields: ${FIELD_KEYS.join(", ")}`);
        process.exit(2);
      }
      if (!(FIELD_KEYS as readonly string[]).includes(rawKey)) {
        console.error(`invalid field: ${rawKey}\nallowed: ${FIELD_KEYS.join(", ")}`);
        process.exit(2);
      }
      const values = rawValues.split(",").map((s) => s.trim()).filter(Boolean);
      if (values.length === 0) {
        console.error("values must be a non-empty comma-separated list");
        process.exit(2);
      }
      setCategoryFields(fieldKeyToCategoryFields(rawKey as FieldKey, values), collection);
      const scope = collection ? `collection '${collection}'` : "global";
      console.log(`set ${rawKey} = [${values.join(", ")}] (${scope})`);
      break;
    }
    case "reset": {
      resetCategoryFields(collection);
      const scope = collection ? `collection '${collection}'` : "global";
      console.log(`reset category fields (${scope})`);
      break;
    }
    default:
      console.error(`unknown subcommand: fields ${sub ?? ""}\nusage: fields get|set|reset [--collection <n>]`);
      process.exit(2);
  }
}

function cmdCollection(args: ParsedArgs): void {
  const sub = args.positional[0];
  switch (sub) {
    case "add": {
      const p = args.positional[1];
      const name = flagStr(args.flags.name);
      if (!p || !name) {
        console.error("usage: qnode collection add <path> --name <n> [--pattern <glob>] [--vault-root <path>]");
        process.exit(2);
      }
      if (!isValidCollectionName(name)) {
        console.error(`invalid collection name: ${name}`);
        process.exit(2);
      }
      const abs = resolve(p);
      const pattern = flagStr(args.flags.pattern) ?? "**/*.md";
      const vault_root = flagStr(args.flags["vault-root"]);
      const ignoreRaw = flagStr(args.flags.ignore);
      const ignore = ignoreRaw ? ignoreRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
      addCollection(name, abs, pattern, { ignore, vault_root: vault_root ? resolve(vault_root) : undefined });
      console.log(`added collection '${name}' at ${abs}`);
      break;
    }
    case "list": {
      const cols = listCollections();
      if (cols.length === 0) {
        console.log("(no collections)");
        return;
      }
      for (const c of cols) {
        console.log(`${c.name}\t${c.path}\t${c.pattern}${c.vault_root ? `\tvault_root=${c.vault_root}` : ""}`);
      }
      break;
    }
    case "remove": {
      const name = args.positional[1];
      if (!name) {
        console.error("usage: qnode collection remove <name>");
        process.exit(2);
      }
      console.log(removeCollection(name) ? `removed ${name}` : `not found: ${name}`);
      break;
    }
    case "rename": {
      const [, oldN, newN] = args.positional;
      if (!oldN || !newN) {
        console.error("usage: qnode collection rename <old> <new>");
        process.exit(2);
      }
      console.log(renameCollection(oldN, newN) ? `renamed ${oldN} → ${newN}` : `not found: ${oldN}`);
      break;
    }
    default:
      console.error(`unknown subcommand: collection ${sub ?? ""}`);
      process.exit(2);
  }
}

async function cmdIndex(args: ParsedArgs): Promise<void> {
  const only = flagStr(args.flags.collection);
  const cols = listCollections().filter((c) => !only || c.name === only);
  if (cols.length === 0) {
    console.error(only ? `no such collection: ${only}` : "no collections registered");
    process.exit(1);
  }
  const store = new Store();
  try {
    for (const col of cols) {
      const fields = effectiveCategoryFields(col.name);
      await indexCollection(store, col, fields, (m) => console.log(m));
    }
  } finally {
    store.close();
  }
}

function cmdStatus(args: ParsedArgs): void {
  const store = new Store();
  try {
    const only = flagStr(args.flags.collection);
    const s = store.status(only);
    console.log(`config:       ${getConfigPath()}`);
    console.log(`nodes:        ${s.nodes}${only ? ` (in '${only}')` : " (in-collection)"}`);
    console.log(`external:     ${s.external_nodes}`);
    console.log(`edges:        ${s.edges}`);
    console.log(`by category:`);
    for (const cat of ALL_CATEGORIES) {
      const n = s.by_category[cat] ?? 0;
      console.log(`  ${cat.padEnd(14)} ${n}`);
    }
    if (!only) {
      console.log(`by collection:`);
      for (const c of s.by_collection) console.log(`  ${c.name.padEnd(20)} ${c.nodes} nodes`);
    }
  } finally {
    store.close();
  }
}

function cmdGet(args: ParsedArgs): void {
  const file = args.positional[0];
  if (!file) {
    console.error("usage: qnode get <file>");
    process.exit(2);
  }
  const store = new Store();
  try {
    const p = resolveFileArg(store, file);
    if (!p) {
      console.error(`not found: ${file}`);
      process.exit(1);
    }
    const detail = getNodeDetail(store, p);
    if (!detail) {
      console.error(`not indexed: ${p}`);
      process.exit(1);
    }
    console.log(JSON.stringify(detail, null, 2));
  } finally {
    store.close();
  }
}

function cmdNeighbors(args: ParsedArgs): void {
  const file = args.positional[0];
  if (!file) {
    console.error("usage: qnode neighbors <file> [--category <cat>] [--direction out|in|both]");
    process.exit(2);
  }
  const store = new Store();
  try {
    const p = resolveFileArg(store, file);
    if (!p) {
      console.error(`not found: ${file}`);
      process.exit(1);
    }
    const cat = flagCategory(args.flags.category);
    const dirRaw = flagStr(args.flags.direction) ?? "both";
    if (dirRaw !== "in" && dirRaw !== "out" && dirRaw !== "both") {
      console.error(`invalid --direction: ${dirRaw} (in|out|both)`);
      process.exit(2);
    }
    const rows = graphNeighbors(store, p, { category: cat, direction: dirRaw });
    if (args.flags.json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    if (rows.length === 0) {
      console.log("(no neighbors)");
      return;
    }
    for (const r of rows) {
      const direction = r.src_path === p ? "→" : "←";
      const other = r.src_path === p ? (r.dst_path ?? r.dst_target) : r.src_path;
      const label = r.field_key ? `${r.category}/${r.field_key}` : r.category;
      console.log(`${direction} [${label}] ${other}`);
    }
  } finally {
    store.close();
  }
}

function cmdSiblings(args: ParsedArgs): void {
  const file = args.positional[0];
  if (!file) {
    console.error("usage: qnode siblings <file> [--shared-min N]");
    process.exit(2);
  }
  const store = new Store();
  try {
    const p = resolveFileArg(store, file);
    if (!p) {
      console.error(`not found: ${file}`);
      process.exit(1);
    }
    const sharedMin = flagNum(args.flags["shared-min"], 1);
    const rows = graphSiblings(store, p, sharedMin);
    if (args.flags.json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    if (rows.length === 0) {
      console.log("(no siblings)");
      return;
    }
    for (const r of rows) console.log(`${r.shared_parents}\t${r.path}`);
  } finally {
    store.close();
  }
}

function cmdDistance(args: ParsedArgs): void {
  const [a, b] = args.positional;
  if (!a || !b) {
    console.error("usage: qnode distance <a> <b> [--max N] [--include-external]");
    process.exit(2);
  }
  const store = new Store();
  try {
    const pa = resolveFileArg(store, a);
    const pb = resolveFileArg(store, b);
    if (!pa || !pb) {
      console.error(`not found: ${pa ? b : a}`);
      process.exit(1);
    }
    const max = flagNum(args.flags.max, 6);
    const includeExternal = !!args.flags["include-external"];
    const d = graphDistance(store, pa, pb, max, includeExternal);
    if (args.flags.json) {
      console.log(JSON.stringify({ distance: d }));
      return;
    }
    if (d === null) console.log(`∞ (no path within ${max} hops)`);
    else console.log(`${d}`);
  } finally {
    store.close();
  }
}

function cmdPath(args: ParsedArgs): void {
  const [a, b] = args.positional;
  if (!a || !b) {
    console.error("usage: qnode path <a> <b> [--max N] [--include-external]");
    process.exit(2);
  }
  const store = new Store();
  try {
    const pa = resolveFileArg(store, a);
    const pb = resolveFileArg(store, b);
    if (!pa || !pb) {
      console.error(`not found: ${pa ? b : a}`);
      process.exit(1);
    }
    const max = flagNum(args.flags.max, 6);
    const includeExternal = !!args.flags["include-external"];
    const p = graphPath(store, pa, pb, max, includeExternal);
    if (args.flags.json) {
      console.log(JSON.stringify({ path: p }));
      return;
    }
    if (!p) console.log(`(no path within ${max} hops)`);
    else for (const n of p) console.log(n);
  } finally {
    store.close();
  }
}

function cmdFindByDistance(args: ParsedArgs): void {
  const file = args.positional[0];
  if (!file) {
    console.error(
      "usage: qnode find-by-distance <file> [--max-distance N] [--file-type <tag>] [--include-existing] [--include-external] [--json]",
    );
    process.exit(2);
  }
  const store = new Store();
  try {
    const p = resolveFileArg(store, file);
    if (!p) {
      console.error(`not found: ${file}`);
      process.exit(1);
    }
    const maxDistance = flagNum(args.flags["max-distance"], 2);
    const fileType = flagStr(args.flags["file-type"]);
    const excludeExisting = !args.flags["include-existing"];
    const includeExternal = !!args.flags["include-external"];
    const rows = graphFindByDistance(store, p, { maxDistance, fileType, excludeExisting, includeExternal });
    if (args.flags.json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    if (rows.length === 0) {
      console.log("(no results)");
      return;
    }
    for (const r of rows) {
      const label = r.title ?? r.path;
      console.log(`${r.distance}\t${label}\t${r.path}`);
    }
  } finally {
    store.close();
  }
}

async function cmdMcp(_args: ParsedArgs): Promise<void> {
  const { startMcp } = await import("../mcp/server.js");
  await startMcp();
}

// Silence unused-import warnings for getCollection (reserved for future use).
void getCollection;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    cmdHelp();
    return;
  }
  const cmd = argv[0]!;
  const args = parseArgs(argv.slice(1));
  switch (cmd) {
    case "collection":
      cmdCollection(args);
      break;
    case "fields":
      cmdFields(args);
      break;
    case "index":
      await cmdIndex(args);
      break;
    case "status":
      cmdStatus(args);
      break;
    case "get":
      cmdGet(args);
      break;
    case "neighbors":
      cmdNeighbors(args);
      break;
    case "siblings":
      cmdSiblings(args);
      break;
    case "distance":
      cmdDistance(args);
      break;
    case "path":
      cmdPath(args);
      break;
    case "find-by-distance":
      cmdFindByDistance(args);
      break;
    case "mcp":
      await cmdMcp(args);
      break;
    default:
      console.error(`unknown command: ${cmd}`);
      cmdHelp();
      process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
