import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const catalogPath = path.resolve(scriptDirectory, "..", "catalog", "latest.json");
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));

if (catalog.schemaVersion !== 1) {
  throw new Error("Unsupported release catalog schema.");
}

const versions = [
  catalog.product?.version,
  catalog.plugins?.codex?.version,
  catalog.plugins?.claude?.version,
];

if (versions.some((version) => typeof version !== "string" || version.length === 0)) {
  throw new Error("The release catalog must define product, Codex, and Claude versions.");
}

if (catalog.product.tag === catalog.plugins.codex.tag) {
  throw new Error("Product and plugin tags must use independent namespaces.");
}

process.stdout.write("release catalog is valid\n");
