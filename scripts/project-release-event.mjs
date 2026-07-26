import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function getArgument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) {
    throw new Error(`Missing required argument ${name}.`);
  }

  return process.argv[index + 1];
}

function requireObject(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }

  return value;
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }

  return value.trim();
}

function requireRevision(value, name) {
  const revision = requireString(value, name);
  if (!/^[0-9a-f]{40}$/i.test(revision)) {
    throw new Error(`${name} must be a full Git commit revision.`);
  }

  return revision.toLowerCase();
}

function requireTimestamp(value, name) {
  const timestamp = requireString(value, name);
  if (
    !/^\d{4}-\d{2}-\d{2}T.+Z$/.test(timestamp) ||
    Number.isNaN(Date.parse(timestamp))
  ) {
    throw new Error(`${name} must be an ISO UTC timestamp ending in Z.`);
  }

  return timestamp;
}

function optionalReleaseUrl(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const releaseUrl = new URL(requireString(value, "releaseUrl"));
  if (releaseUrl.protocol !== "https:" || releaseUrl.hostname !== "github.com") {
    throw new Error("releaseUrl must be an HTTPS github.com URL.");
  }

  return releaseUrl.toString();
}

function requireCatalogShape(catalog) {
  requireObject(catalog, "catalog");
  if (catalog.schemaVersion !== 1) {
    throw new Error("Unsupported release catalog schema.");
  }

  requireString(catalog.product?.version, "catalog.product.version");
  requireString(catalog.product?.tag, "catalog.product.tag");
  requireString(catalog.plugins?.codex?.version, "catalog.plugins.codex.version");
  requireString(catalog.plugins?.claude?.version, "catalog.plugins.claude.version");
  requireString(catalog.plugins?.codex?.tag, "catalog.plugins.codex.tag");
  requireString(catalog.plugins?.claude?.tag, "catalog.plugins.claude.tag");
}

const payloadPath = path.resolve(getArgument("--payload"));
const catalogPath = path.resolve(getArgument("--catalog"));
const outputPath = path.resolve(getArgument("--output"));
const payload = JSON.parse(await readFile(payloadPath, "utf8"));
const baseline = JSON.parse(await readFile(catalogPath, "utf8"));

requireObject(payload, "payload");
requireCatalogShape(baseline);

if (payload.schemaVersion !== 1) {
  throw new Error("Unsupported release event schema.");
}

const eventKind = requireString(payload.eventKind, "eventKind");
if (!["product", "plugins"].includes(eventKind)) {
  throw new Error("eventKind must be product or plugins.");
}

const channel = requireString(payload.channel, "channel");
if (!["pilot", "preview", "stable"].includes(channel)) {
  throw new Error("channel must be pilot, preview, or stable.");
}

const createdAt = requireTimestamp(payload.createdAt, "createdAt");
const source = requireObject(payload.source, "source");
const sourceRepository = requireString(source.repository, "source.repository");
const sourceRevision = requireRevision(source.revision, "source.revision");
const sourceTag = requireString(source.tag, "source.tag");
const releaseUrl = optionalReleaseUrl(payload.releaseUrl);
const catalog = structuredClone(baseline);

catalog.channel = channel;
catalog.updatedAt = createdAt;

if (eventKind === "product") {
  if (sourceRepository !== "termbrio/tb") {
    throw new Error("Product events must originate from termbrio/tb.");
  }

  const product = requireObject(payload.product, "product");
  const version = requireString(product.version, "product.version");
  const expectedTag = `product-v${version}`;
  if (sourceTag !== expectedTag) {
    throw new Error(`Product tag must be ${expectedTag}.`);
  }

  catalog.product = {
    version,
    tag: sourceTag,
    sourceRepository,
    sourceRevision,
    releaseUrl,
  };
} else {
  if (sourceRepository !== "termbrio/tbmp") {
    throw new Error("Plugin events must originate from termbrio/tbmp.");
  }

  const plugins = requireObject(payload.plugins, "plugins");
  const releaseVersion = requireString(
    plugins.releaseVersion,
    "plugins.releaseVersion",
  );
  const codexVersion = requireString(
    plugins.codexVersion,
    "plugins.codexVersion",
  );
  const claudeVersion = requireString(
    plugins.claudeVersion,
    "plugins.claudeVersion",
  );
  const expectedTag = `plugins-v${releaseVersion}`;
  if (sourceTag !== expectedTag) {
    throw new Error(`Plugin tag must be ${expectedTag}.`);
  }

  const shared = {
    tag: sourceTag,
    sourceRepository,
    sourceRevision,
    releaseUrl,
  };
  catalog.plugins = {
    codex: {
      version: codexVersion,
      ...shared,
    },
    claude: {
      version: claudeVersion,
      ...shared,
    },
  };
}

requireCatalogShape(catalog);
if (catalog.product.tag === catalog.plugins.codex.tag) {
  throw new Error("Product and plugin tags must use independent namespaces.");
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify(catalog, null, 2)}\n`,
  "utf8",
);

process.stdout.write(
  `projected ${eventKind} release event to ${outputPath}\n`,
);
