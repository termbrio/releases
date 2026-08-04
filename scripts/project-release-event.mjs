import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const CHANGE_TYPES = new Set([
  "added",
  "changed",
  "fixed",
  "deprecated",
  "removed",
  "security",
]);
const CHANNELS = new Set(["pilot", "preview", "stable"]);
const PROVIDERS = new Set(["codex", "claude"]);
const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

function compareVersions(left, right) {
  const parse = (value) => {
    const separator = value.indexOf("-");
    const core = separator < 0 ? value : value.slice(0, separator);
    const prerelease = separator < 0 ? null : value.slice(separator + 1).split(".");
    return {
      core: core.split(".").map((part) => Number.parseInt(part, 10)),
      prerelease,
    };
  };
  const leftVersion = parse(left);
  const rightVersion = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftVersion.core[index] !== rightVersion.core[index]) {
      return leftVersion.core[index] - rightVersion.core[index];
    }
  }
  if (leftVersion.prerelease === null || rightVersion.prerelease === null) {
    if (leftVersion.prerelease === rightVersion.prerelease) return 0;
    return leftVersion.prerelease === null ? 1 : -1;
  }

  const count = Math.max(
    leftVersion.prerelease.length,
    rightVersion.prerelease.length,
  );
  for (let index = 0; index < count; index += 1) {
    const leftPart = leftVersion.prerelease[index];
    const rightPart = rightVersion.prerelease[index];
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      return Number.parseInt(leftPart, 10) - Number.parseInt(rightPart, 10);
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

function laterTimestamp(left, right) {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

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

function requireExactProperties(value, allowed, required, name) {
  const names = Object.keys(requireObject(value, name));
  for (const requiredName of required) {
    if (!names.includes(requiredName)) {
      throw new Error(`${name} is missing required property ${requiredName}.`);
    }
  }

  const unknown = names.filter((propertyName) => !allowed.includes(propertyName));
  if (unknown.length > 0) {
    throw new Error(`${name} contains unsupported properties: ${unknown.join(", ")}.`);
  }
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }

  return value.trim();
}

function requirePlainText(value, name) {
  const text = requireString(value, name);
  if (/[\r\n<>]/.test(text)) {
    throw new Error(`${name} must be single-line plain text.`);
  }

  return text;
}

function requireRevision(value, name) {
  const revision = requireString(value, name);
  if (!/^[0-9a-f]{40}$/i.test(revision)) {
    throw new Error(`${name} must be a full Git commit revision.`);
  }

  return revision.toLowerCase();
}

function requireDigest(value, name) {
  const digest = requireString(value, name);
  if (!/^[0-9a-f]{64}$/i.test(digest)) {
    throw new Error(`${name} must be a SHA256 digest.`);
  }

  return digest.toLowerCase();
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

function optionalReleaseUrl(value, name = "releaseUrl") {
  if (value === null || value === undefined) {
    return null;
  }

  const releaseUrl = new URL(requireString(value, name));
  if (releaseUrl.protocol !== "https:" || releaseUrl.hostname !== "github.com") {
    throw new Error(`${name} must be an HTTPS github.com URL.`);
  }

  return releaseUrl.toString();
}

function requireReleaseAssets(value, name) {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array.`);
  }

  const seenNames = new Set();
  return value.map((rawAsset, index) => {
    const assetName = `${name}[${index}]`;
    const asset = requireObject(rawAsset, assetName);
    const fileName = requireString(asset.name, `${assetName}.name`);
    if (
      fileName === "." ||
      fileName === ".." ||
      fileName.includes("/") ||
      fileName.includes("\\")
    ) {
      throw new Error(`${assetName}.name must be a safe leaf name.`);
    }
    if (seenNames.has(fileName)) {
      throw new Error(`${name} contains duplicate asset name ${fileName}.`);
    }
    seenNames.add(fileName);
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0) {
      throw new Error(`${assetName}.size must be a positive safe integer.`);
    }

    return {
      name: fileName,
      kind: requireString(asset.kind, `${assetName}.kind`),
      platform: requireString(asset.platform, `${assetName}.platform`),
      runtime: requireString(asset.runtime, `${assetName}.runtime`),
      size: asset.size,
      sha256: requireDigest(asset.sha256, `${assetName}.sha256`),
    };
  });
}

function requireChangelogEntry(value, eventKind, version, channel) {
  const name = "changelog";
  requireExactProperties(
    value,
    ["schemaVersion", "component", "version", "channel", "status", "summary", "changes"],
    ["schemaVersion", "component", "version", "channel", "status", "summary", "changes"],
    name,
  );
  if (value.schemaVersion !== 1) {
    throw new Error("changelog.schemaVersion must be 1.");
  }

  const expectedComponent = eventKind === "product" ? "product" : "plugins";
  if (value.component !== expectedComponent) {
    throw new Error(`changelog.component must be ${expectedComponent}.`);
  }
  if (requireString(value.version, "changelog.version") !== version) {
    throw new Error("changelog.version does not match the release version.");
  }
  if (!VERSION_PATTERN.test(value.version)) {
    throw new Error("changelog.version must be a semantic release version.");
  }
  if (value.channel !== channel) {
    throw new Error("changelog.channel does not match the event channel.");
  }
  if (value.status !== "ready") {
    throw new Error("Published release events require status=ready changelog entries.");
  }
  const summary = requirePlainText(value.summary, "changelog.summary");
  if (!Array.isArray(value.changes) || value.changes.length === 0) {
    throw new Error("changelog.changes must contain at least one item.");
  }

  const changes = value.changes.map((rawChange, index) => {
    const changeName = `changelog.changes[${index}]`;
    requireExactProperties(
      rawChange,
      ["type", "area", "text", "providers"],
      ["type", "area", "text"],
      changeName,
    );
    const type = requireString(rawChange.type, `${changeName}.type`);
    if (!CHANGE_TYPES.has(type)) {
      throw new Error(`${changeName}.type is unsupported.`);
    }
    const area = requireString(rawChange.area, `${changeName}.area`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(area)) {
      throw new Error(`${changeName}.area is invalid.`);
    }

    const change = {
      type,
      area,
      text: requirePlainText(rawChange.text, `${changeName}.text`),
    };
    if (rawChange.providers !== undefined) {
      if (eventKind !== "plugins") {
        throw new Error(`${changeName}.providers is plugin-only.`);
      }
      if (!Array.isArray(rawChange.providers) || rawChange.providers.length === 0) {
        throw new Error(`${changeName}.providers must be a non-empty array.`);
      }
      const providers = rawChange.providers.map((provider, providerIndex) => {
        const normalized = requireString(
          provider,
          `${changeName}.providers[${providerIndex}]`,
        );
        if (!PROVIDERS.has(normalized)) {
          throw new Error(`${changeName}.providers contains ${normalized}.`);
        }
        return normalized;
      });
      if (new Set(providers).size !== providers.length) {
        throw new Error(`${changeName}.providers must be unique.`);
      }
      change.providers = providers;
    }
    return change;
  });

  return {
    schemaVersion: 1,
    component: expectedComponent,
    version,
    channel,
    status: "ready",
    summary,
    changes,
  };
}

function requireCatalogShape(catalog) {
  requireObject(catalog, "catalog");
  if (catalog.schemaVersion !== 1) {
    throw new Error("Unsupported release catalog schema.");
  }
  requireString(catalog.product?.version, "catalog.product.version");
  requireString(catalog.product?.tag, "catalog.product.tag");
  requireReleaseAssets(catalog.product?.assets, "catalog.product.assets");
  requireString(catalog.plugins?.codex?.version, "catalog.plugins.codex.version");
  requireString(catalog.plugins?.claude?.version, "catalog.plugins.claude.version");
  requireString(catalog.plugins?.codex?.tag, "catalog.plugins.codex.tag");
  requireString(catalog.plugins?.claude?.tag, "catalog.plugins.claude.tag");
}

function requireChangelogShape(changelog) {
  requireObject(changelog, "catalog changelog");
  if (changelog.schemaVersion !== 1 || !Array.isArray(changelog.releases)) {
    throw new Error("Unsupported catalog changelog schema.");
  }
}

const payloadPath = path.resolve(getArgument("--payload"));
const catalogPath = path.resolve(getArgument("--catalog"));
const outputPath = path.resolve(getArgument("--output"));
const changelogPath = path.resolve(getArgument("--changelog"));
const changelogOutputPath = path.resolve(getArgument("--changelog-output"));
const changelogOnly = process.argv.includes("--changelog-only");
const payload = JSON.parse(await readFile(payloadPath, "utf8"));
const baseline = JSON.parse(await readFile(catalogPath, "utf8"));
const changelogBaseline = JSON.parse(await readFile(changelogPath, "utf8"));

requireObject(payload, "payload");
requireCatalogShape(baseline);
requireChangelogShape(changelogBaseline);
if (payload.schemaVersion !== 1) {
  throw new Error("Unsupported release event schema.");
}

const eventKind = requireString(payload.eventKind, "eventKind");
if (!["product", "plugins"].includes(eventKind)) {
  throw new Error("eventKind must be product or plugins.");
}
const channel = requireString(payload.channel, "channel");
if (!CHANNELS.has(channel)) {
  throw new Error("channel must be pilot, preview, or stable.");
}
const createdAt = requireTimestamp(payload.createdAt, "createdAt");
const source = requireObject(payload.source, "source");
const sourceRepository = requireString(source.repository, "source.repository");
const sourceRevision = requireRevision(source.revision, "source.revision");
const sourceTag = requireString(source.tag, "source.tag");
const entryDigest = requireDigest(source.entryDigest, "source.entryDigest");
const releaseUrl = optionalReleaseUrl(payload.releaseUrl);
const catalog = structuredClone(baseline);
const changelog = structuredClone(changelogBaseline);

let releaseRecord;
let catalogProduct;
let catalogPlugins;
let releaseVersion;

if (eventKind === "product") {
  if (sourceRepository !== "termbrio/tb") {
    throw new Error("Product events must originate from termbrio/tb.");
  }
  const product = requireObject(payload.product, "product");
  const version = requireString(product.version, "product.version");
  releaseVersion = version;
  const assets = requireReleaseAssets(product.assets ?? [], "product.assets");
  const release = requireObject(payload.release, "release");
  const artifactTag = requireString(release.tag, "release.tag");
  const artifactUrl = optionalReleaseUrl(release.url, "release.url");
  if (sourceTag !== `v${version}`) {
    throw new Error(`Product source tag must be v${version}.`);
  }
  if (artifactTag !== `product-v${version}`) {
    throw new Error(`Product artifact tag must be product-v${version}.`);
  }
  const expectedReleaseUrl =
    `https://github.com/termbrio/releases/releases/tag/product-v${version}`;
  if (artifactUrl !== releaseUrl) {
    throw new Error("release.url must match releaseUrl.");
  }
  if (releaseUrl !== expectedReleaseUrl) {
    throw new Error(`Product releaseUrl must be ${expectedReleaseUrl}.`);
  }
  if (changelogOnly && assets.length !== 0) {
    throw new Error("Changelog-only product projection must not contain assets.");
  }
  if (!changelogOnly && assets.length === 0) {
    throw new Error(
      "Published product events require a non-empty asset inventory.",
    );
  }
  const entry = requireChangelogEntry(payload.changelog, eventKind, version, channel);
  catalogProduct = {
    version,
    tag: artifactTag,
    sourceTag,
    sourceRepository,
    sourceRevision,
    releaseUrl,
    assets,
  };
  releaseRecord = {
    component: "product",
    version,
    channel,
    publishedAt: createdAt,
    sourceRepository,
    sourceRevision,
    sourceTag,
    entryDigest,
    releaseTag: artifactTag,
    releaseUrl,
    summary: entry.summary,
    changes: entry.changes,
  };
} else {
  if (sourceRepository !== "termbrio/tbmp") {
    throw new Error("Plugin events must originate from termbrio/tbmp.");
  }
  const plugins = requireObject(payload.plugins, "plugins");
  const pluginVersion = requireString(
    plugins.releaseVersion,
    "plugins.releaseVersion",
  );
  releaseVersion = pluginVersion;
  const codexVersion = requireString(plugins.codexVersion, "plugins.codexVersion");
  const claudeVersion = requireString(
    plugins.claudeVersion,
    "plugins.claudeVersion",
  );
  if (
    pluginVersion !== codexVersion.replace(/\+.*/, "") ||
    pluginVersion !== claudeVersion
  ) {
    throw new Error(
      "Plugin release version must match the Codex base and Claude versions.",
    );
  }
  if (sourceTag !== `v${pluginVersion}`) {
    throw new Error(`Plugin tag must be v${pluginVersion}.`);
  }
  const expectedReleaseUrl =
    `https://github.com/termbrio/tbmp/releases/tag/v${pluginVersion}`;
  if (releaseUrl !== expectedReleaseUrl) {
    throw new Error(`Plugin releaseUrl must be ${expectedReleaseUrl}.`);
  }
  const entry = requireChangelogEntry(
    payload.changelog,
    eventKind,
    pluginVersion,
    channel,
  );
  const shared = { tag: sourceTag, sourceRepository, sourceRevision, releaseUrl };
  catalogPlugins = {
    codex: { version: codexVersion, ...shared },
    claude: { version: claudeVersion, ...shared },
  };
  releaseRecord = {
    component: "plugins",
    version: pluginVersion,
    channel,
    publishedAt: createdAt,
    sourceRepository,
    sourceRevision,
    sourceTag,
    entryDigest,
    releaseTag: sourceTag,
    releaseUrl,
    summary: entry.summary,
    changes: entry.changes,
  };
}

const existingRecord = changelog.releases.find(
  (item) =>
    item?.component === releaseRecord.component &&
    item?.version === releaseRecord.version,
);
if (existingRecord === undefined) {
  const currentVersion =
    eventKind === "product"
      ? requireString(baseline.product?.version, "catalog.product.version")
      : requireString(
          baseline.plugins?.claude?.version,
          "catalog.plugins.claude.version",
        );
  if (compareVersions(releaseVersion, currentVersion) <= 0) {
    throw new Error(
      `Out-of-order ${eventKind} release ${releaseVersion} does not advance ${currentVersion}.`,
    );
  }

  const latestComponentRecord = changelog.releases
    .filter((item) => item?.component === releaseRecord.component)
    .sort((left, right) => {
      const timeOrder = Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
      if (timeOrder !== 0) return timeOrder;
      return compareVersions(right.version, left.version);
    })[0];
  const componentTimestampFloor =
    latestComponentRecord?.publishedAt ?? requireTimestamp(baseline.updatedAt, "catalog.updatedAt");
  if (Date.parse(createdAt) <= Date.parse(componentTimestampFloor)) {
    throw new Error(
      `Out-of-order ${eventKind} release timestamp ${createdAt} does not advance ${componentTimestampFloor}.`,
    );
  }

  changelog.releases.push(releaseRecord);
  changelog.updatedAt = laterTimestamp(
    requireTimestamp(changelog.updatedAt, "catalog changelog.updatedAt"),
    createdAt,
  );
  changelog.releases.sort((left, right) => {
    const timeOrder = right.publishedAt.localeCompare(left.publishedAt);
    if (timeOrder !== 0) return timeOrder;
    const componentOrder = left.component.localeCompare(right.component);
    if (componentOrder !== 0) return componentOrder;
    return compareVersions(right.version, left.version);
  });

  if (!changelogOnly) {
    if (eventKind === "product") {
      catalog.product = catalogProduct;
    } else {
      catalog.plugins = catalogPlugins;
    }
    const previousUpdatedAt = requireTimestamp(catalog.updatedAt, "catalog.updatedAt");
    if (Date.parse(createdAt) > Date.parse(previousUpdatedAt)) {
      catalog.channel = channel;
      catalog.updatedAt = createdAt;
    }
  }
} else if (JSON.stringify(existingRecord) !== JSON.stringify(releaseRecord)) {
  throw new Error(
    `Release history conflict for ${releaseRecord.component} ${releaseRecord.version}.`,
  );
}

requireCatalogShape(catalog);
if (catalog.product.tag === catalog.plugins.codex.tag) {
  throw new Error("Product and plugin tags must use independent namespaces.");
}

await Promise.all([
  mkdir(path.dirname(outputPath), { recursive: true }),
  mkdir(path.dirname(changelogOutputPath), { recursive: true }),
]);
await Promise.all([
  writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8"),
  writeFile(
    changelogOutputPath,
    `${JSON.stringify(changelog, null, 2)}\n`,
    "utf8",
  ),
]);

process.stdout.write(
  `projected ${eventKind} release event to ${outputPath} and ${changelogOutputPath}\n`,
);
