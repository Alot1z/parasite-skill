// Shared helpers for command modules.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const fmt = (p) => p.replace(/\\/g, "/");

export function readTemplate(name) {
  return readFileSync(join(PKG_ROOT, "skill", "templates", name), "utf-8");
}
