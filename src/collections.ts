/**
 * Collections configuration for qnode.
 * YAML config at ~/.config/qnode/index.yml
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import YAML from "yaml";
import {
  DEFAULT_CATEGORY_FIELDS,
  resolveCategoryFields,
  type CategoryFields,
} from "./categories.js";

export interface Collection {
  path: string;
  pattern: string;
  ignore?: string[];
  vault_root?: string;
  category_fields?: Partial<CategoryFields>;
}

export interface CollectionConfig {
  collections: Record<string, Collection>;
  category_fields?: Partial<CategoryFields>;
}

export interface NamedCollection extends Collection {
  name: string;
}

function getConfigDir(): string {
  if (process.env.QNODE_CONFIG_DIR) return process.env.QNODE_CONFIG_DIR;
  if (process.env.XDG_CONFIG_HOME) return join(process.env.XDG_CONFIG_HOME, "qnode");
  return join(homedir(), ".config", "qnode");
}

function getConfigFilePath(): string {
  return join(getConfigDir(), "index.yml");
}

export function loadConfig(): CollectionConfig {
  const path = getConfigFilePath();
  if (!existsSync(path)) return { collections: {} };
  try {
    const content = readFileSync(path, "utf-8");
    const config = (YAML.parse(content) as CollectionConfig) ?? { collections: {} };
    if (!config.collections) config.collections = {};
    return config;
  } catch (e) {
    throw new Error(`Failed to parse ${path}: ${(e as Error).message}`);
  }
}

export function saveConfig(config: CollectionConfig): void {
  const path = getConfigFilePath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, YAML.stringify(config, { indent: 2, lineWidth: 0 }), "utf-8");
}

export function listCollections(): NamedCollection[] {
  const config = loadConfig();
  return Object.entries(config.collections).map(([name, c]) => ({ name, ...c }));
}

export function getCollection(name: string): NamedCollection | null {
  const config = loadConfig();
  const c = config.collections[name];
  return c ? { name, ...c } : null;
}

export function addCollection(
  name: string,
  path: string,
  pattern: string = "**/*.md",
  opts?: { ignore?: string[]; vault_root?: string },
): void {
  const config = loadConfig();
  config.collections[name] = {
    path,
    pattern,
    ...(opts?.ignore ? { ignore: opts.ignore } : {}),
    ...(opts?.vault_root ? { vault_root: opts.vault_root } : {}),
  };
  saveConfig(config);
}

export function removeCollection(name: string): boolean {
  const config = loadConfig();
  if (!config.collections[name]) return false;
  delete config.collections[name];
  saveConfig(config);
  return true;
}

export function renameCollection(oldName: string, newName: string): boolean {
  const config = loadConfig();
  if (!config.collections[oldName]) return false;
  if (config.collections[newName]) throw new Error(`Collection '${newName}' already exists`);
  config.collections[newName] = config.collections[oldName]!;
  delete config.collections[oldName];
  saveConfig(config);
  return true;
}

export function getConfigPath(): string {
  return getConfigFilePath();
}

export function isValidCollectionName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

/**
 * Resolve the effective CategoryFields for a named collection: collection
 * override wins over global, which wins over built-in defaults.
 */
export function effectiveCategoryFields(collectionName: string): CategoryFields {
  const cfg = loadConfig();
  const col = cfg.collections[collectionName];
  const global = resolveCategoryFields(cfg.category_fields);
  if (!col?.category_fields) return global;
  return resolveCategoryFields({ ...global, ...col.category_fields });
}

export { DEFAULT_CATEGORY_FIELDS };
