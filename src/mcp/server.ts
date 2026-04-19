/**
 * Minimal MCP server for qnode.
 *
 * Tools:
 *   siblings(path, shared_min?, collection?) → { path, shared_parents }[]
 *   neighbors(path, category?, direction?, collection?) → Edge[]
 *   distance(from, to, max?, include_external?) → { distance: number | null }
 *   path(from, to, max?, include_external?) → { path: string[] | null }
 *   get(path) → { node, outgoing, incoming }
 *   status(collection?) → { nodes, external_nodes, edges, by_category, by_collection }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Store } from "../store.js";
import {
  distance as graphDistance,
  findByDistance as graphFindByDistance,
  getNodeDetail,
  neighbors as graphNeighbors,
  path as graphPath,
  resolveFileArg,
  siblings as graphSiblings,
} from "../graph.js";
import { ALL_CATEGORIES, isCategory, type Category } from "../categories.js";

function jsonText(obj: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

function errText(msg: string): { content: { type: "text"; text: string }[]; isError: true } {
  return { content: [{ type: "text", text: msg }], isError: true };
}

export async function startMcp(): Promise<void> {
  const server = new Server(
    { name: "qnode", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  const store = new Store();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "siblings",
        description:
          "Files that share one or more Up (topic/parent) links with the given file. Results are ranked by number of shared parents.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Absolute or suffix path of the file" },
            shared_min: { type: "number", description: "Minimum shared parents (default 1)" },
          },
          required: ["path"],
        },
      },
      {
        name: "neighbors",
        description:
          "Categorized links to/from the given file. Filter by category (Up/Down/Right/Left/In/Out/Uncategorized) and direction (in/out/both).",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            category: { type: "string", enum: [...ALL_CATEGORIES] },
            direction: { type: "string", enum: ["in", "out", "both"] },
          },
          required: ["path"],
        },
      },
      {
        name: "distance",
        description:
          "Shortest-path distance (in hops) between two files via the link graph. Returns null if unreachable within max hops.",
        inputSchema: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            max: { type: "number", description: "Max hops to search (default 6)" },
            include_external: {
              type: "boolean",
              description:
                "If true, allow hops through files outside the collection (default false)",
            },
          },
          required: ["from", "to"],
        },
      },
      {
        name: "path",
        description: "A shortest path between two files, expressed as a list of file paths.",
        inputSchema: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            max: { type: "number" },
            include_external: { type: "boolean" },
          },
          required: ["from", "to"],
        },
      },
      {
        name: "get",
        description: "Fetch a node with all its incoming and outgoing categorized edges.",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
      {
        name: "status",
        description: "Index status: node counts, edge counts, totals by category and collection.",
        inputSchema: {
          type: "object",
          properties: { collection: { type: "string" } },
        },
      },
      {
        name: "find_by_distance",
        description:
          "Find all nodes reachable within max_distance hops from a file. Optionally filter by frontmatter type/tags field and exclude files already directly linked.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Source file (absolute or suffix path)" },
            file_type: {
              type: "string",
              description:
                "Filter results to nodes whose frontmatter `type` field or `tags` array matches this value (e.g. 'claim', 'book')",
            },
            max_distance: {
              type: "number",
              description: "Maximum hops from source (default 2)",
            },
            exclude_existing: {
              type: "boolean",
              description:
                "Exclude files already directly linked to the source (distance 1). Default true.",
            },
            include_external: {
              type: "boolean",
              description: "Allow hops through files outside any collection (default false)",
            },
          },
          required: ["path"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: a } = req.params;
    const args = (a ?? {}) as Record<string, unknown>;

    if (name === "siblings") {
      const p = typeof args.path === "string" ? args.path : "";
      if (!p) return errText("missing path");
      const resolved = resolveFileArg(store, p);
      if (!resolved) return errText(`not found: ${p}`);
      const sharedMin = typeof args.shared_min === "number" ? args.shared_min : 1;
      return jsonText(graphSiblings(store, resolved, sharedMin));
    }
    if (name === "neighbors") {
      const p = typeof args.path === "string" ? args.path : "";
      if (!p) return errText("missing path");
      const resolved = resolveFileArg(store, p);
      if (!resolved) return errText(`not found: ${p}`);
      const catRaw = typeof args.category === "string" ? args.category : undefined;
      if (catRaw && !isCategory(catRaw)) {
        return errText(`invalid category: ${catRaw} (allowed: ${ALL_CATEGORIES.join(", ")})`);
      }
      const category = catRaw as Category | undefined;
      const dir = typeof args.direction === "string" ? args.direction : "both";
      if (dir !== "in" && dir !== "out" && dir !== "both") {
        return errText(`invalid direction: ${dir}`);
      }
      return jsonText(graphNeighbors(store, resolved, { category, direction: dir }));
    }
    if (name === "distance") {
      const from = typeof args.from === "string" ? args.from : "";
      const to = typeof args.to === "string" ? args.to : "";
      if (!from || !to) return errText("missing from/to");
      const rf = resolveFileArg(store, from);
      const rt = resolveFileArg(store, to);
      if (!rf || !rt) return errText(`not found: ${rf ? to : from}`);
      const max = typeof args.max === "number" ? args.max : 6;
      const includeExternal = !!args.include_external;
      return jsonText({ distance: graphDistance(store, rf, rt, max, includeExternal) });
    }
    if (name === "path") {
      const from = typeof args.from === "string" ? args.from : "";
      const to = typeof args.to === "string" ? args.to : "";
      if (!from || !to) return errText("missing from/to");
      const rf = resolveFileArg(store, from);
      const rt = resolveFileArg(store, to);
      if (!rf || !rt) return errText(`not found: ${rf ? to : from}`);
      const max = typeof args.max === "number" ? args.max : 6;
      const includeExternal = !!args.include_external;
      return jsonText({ path: graphPath(store, rf, rt, max, includeExternal) });
    }
    if (name === "get") {
      const p = typeof args.path === "string" ? args.path : "";
      if (!p) return errText("missing path");
      const resolved = resolveFileArg(store, p);
      if (!resolved) return errText(`not found: ${p}`);
      const d = getNodeDetail(store, resolved);
      if (!d) return errText(`not indexed: ${resolved}`);
      return jsonText(d);
    }
    if (name === "status") {
      const col = typeof args.collection === "string" ? args.collection : undefined;
      return jsonText(store.status(col));
    }
    if (name === "find_by_distance") {
      const p = typeof args.path === "string" ? args.path : "";
      if (!p) return errText("missing path");
      const resolved = resolveFileArg(store, p);
      if (!resolved) return errText(`not found: ${p}`);
      const fileType = typeof args.file_type === "string" ? args.file_type : undefined;
      const maxDistance = typeof args.max_distance === "number" ? args.max_distance : 2;
      const excludeExisting = args.exclude_existing !== false;
      const includeExternal = !!args.include_external;
      return jsonText(
        graphFindByDistance(store, resolved, { fileType, maxDistance, excludeExisting, includeExternal }),
      );
    }
    return errText(`unknown tool: ${name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
