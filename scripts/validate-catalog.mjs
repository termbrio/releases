import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const catalogRoot = path.resolve(scriptDirectory, "..", "catalog");
const catalog = JSON.parse(
  await readFile(path.join(catalogRoot, "latest.json"), "utf8"),
);
const changelog = JSON.parse(
  await readFile(path.join(catalogRoot, "changelog.json"), "utf8"),
);

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

if (
  changelog.schemaVersion !== 1 ||
  typeof changelog.updatedAt !== "string" ||
  Number.isNaN(Date.parse(changelog.updatedAt)) ||
  !Array.isArray(changelog.releases)
) {
  throw new Error("The public changelog projection is invalid.");
}

const releaseKeys = new Set();
for (const release of changelog.releases) {
  if (
    release === null ||
    typeof release !== "object" ||
    Array.isArray(release) ||
    !["product", "plugins"].includes(release.component) ||
    typeof release.version !== "string" ||
    release.version.length === 0 ||
    !["pilot", "preview", "stable"].includes(release.channel) ||
    typeof release.publishedAt !== "string" ||
    Number.isNaN(Date.parse(release.publishedAt)) ||
    !["termbrio/tb", "termbrio/tbmp"].includes(release.sourceRepository) ||
    typeof release.sourceRevision !== "string" ||
    !/^[0-9a-f]{40}$/.test(release.sourceRevision) ||
    typeof release.sourceTag !== "string" ||
    typeof release.entryDigest !== "string" ||
    !/^[0-9a-f]{64}$/.test(release.entryDigest) ||
    typeof release.releaseTag !== "string" ||
    typeof release.releaseUrl !== "string" ||
    typeof release.summary !== "string" ||
    release.summary.length === 0 ||
    /[\r\n<>]/.test(release.summary) ||
    !Array.isArray(release.changes) ||
    release.changes.length === 0
  ) {
    throw new Error("The public changelog contains an invalid release entry.");
  }

  const expectedSource =
    release.component === "product" ? "termbrio/tb" : "termbrio/tbmp";
  const expectedSourceTag = `v${release.version}`;
  const expectedReleaseTag =
    release.component === "product"
      ? `product-v${release.version}`
      : expectedSourceTag;
  const expectedReleaseUrl =
    release.component === "product"
      ? `https://github.com/termbrio/releases/releases/tag/${expectedReleaseTag}`
      : `https://github.com/termbrio/tbmp/releases/tag/${expectedReleaseTag}`;
  if (
    release.sourceRepository !== expectedSource ||
    release.sourceTag !== expectedSourceTag ||
    release.releaseTag !== expectedReleaseTag ||
    release.releaseUrl !== expectedReleaseUrl
  ) {
    throw new Error("The public changelog contains inconsistent release identity.");
  }

  const key = `${release.component}:${release.version}`;
  if (releaseKeys.has(key)) {
    throw new Error(`The public changelog contains duplicate release ${key}.`);
  }
  releaseKeys.add(key);
}

process.stdout.write("release catalog and changelog are valid\n");
