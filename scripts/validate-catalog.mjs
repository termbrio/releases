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

if (!Array.isArray(catalog.product?.assets)) {
  throw new Error("The product release catalog must define an asset inventory.");
}

const assetNames = new Set();
for (const asset of catalog.product.assets) {
  if (
    asset === null ||
    typeof asset !== "object" ||
    Array.isArray(asset) ||
    typeof asset.name !== "string" ||
    asset.name.length === 0 ||
    asset.name.includes("/") ||
    asset.name.includes("\\") ||
    typeof asset.kind !== "string" ||
    asset.kind.length === 0 ||
    typeof asset.platform !== "string" ||
    asset.platform.length === 0 ||
    typeof asset.runtime !== "string" ||
    asset.runtime.length === 0 ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0 ||
    typeof asset.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/i.test(asset.sha256)
  ) {
    throw new Error("The product release catalog contains an invalid asset.");
  }

  if (assetNames.has(asset.name)) {
    throw new Error(`The product release catalog contains duplicate asset ${asset.name}.`);
  }
  assetNames.add(asset.name);
}

if (
  catalog.product.assets.length > 0 &&
  (typeof catalog.product.releaseUrl !== "string" ||
    catalog.product.releaseUrl.length === 0)
) {
  throw new Error("A published product asset inventory requires a release URL.");
}

if (catalog.product.tag === catalog.plugins.codex.tag) {
  throw new Error("Product and plugin tags must use independent namespaces.");
}

process.stdout.write("release catalog is valid\n");
