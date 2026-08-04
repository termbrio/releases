import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const projectorPath = path.join(scriptDirectory, "project-release-event.mjs");
const catalogPath = path.join(repositoryRoot, "catalog", "latest.json");
const changelogPath = path.join(repositoryRoot, "catalog", "changelog.json");
const temporaryRoot = await mkdtemp(
  path.join(os.tmpdir(), "termbrio-release-event-"),
);

function runProjector(
  payloadPath,
  baselineCatalogPath,
  baselineChangelogPath,
  outputCatalogPath,
  outputChangelogPath,
) {
  return spawnSync(
    process.execPath,
    [
      projectorPath,
      "--payload",
      payloadPath,
      "--catalog",
      baselineCatalogPath,
      "--output",
      outputCatalogPath,
      "--changelog",
      baselineChangelogPath,
      "--changelog-output",
      outputChangelogPath,
    ],
    { encoding: "utf8" },
  );
}

async function writePayload(payloadPath, payload) {
  await writeFile(payloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

try {
  const revision = "0123456789abcdef0123456789abcdef01234567";
  const releaseUrl =
    "https://github.com/termbrio/releases/releases/tag/product-v0.5.8";
  const productPayload = {
    schemaVersion: 1,
    eventKind: "product",
    channel: "preview",
    createdAt: "2026-08-04T20:30:00.0000000Z",
    source: {
      repository: "termbrio/tb",
      revision,
      tag: "v0.5.8",
      entryDigest: "a".repeat(64),
    },
    release: {
      tag: "product-v0.5.8",
      url: releaseUrl,
    },
    releaseUrl,
    changelog: {
      schemaVersion: 1,
      component: "product",
      version: "0.5.8",
      channel: "preview",
      status: "ready",
      summary: "Makes product releases unattended.",
      changes: [
        {
          type: "changed",
          area: "release",
          text: "Projects one reviewed changelog entry everywhere.",
        },
      ],
    },
    product: {
      version: "0.5.8",
      assets: [
        {
          name: "termbrio-dev-win-x64.zip",
          kind: "package",
          platform: "windows",
          runtime: "win-x64",
          size: 12345,
          sha256: "c".repeat(64),
        },
      ],
    },
  };
  const payloadPath = path.join(temporaryRoot, "event.json");
  const productCatalogPath = path.join(temporaryRoot, "product-catalog.json");
  const productChangelogPath = path.join(
    temporaryRoot,
    "product-changelog.json",
  );
  await writePayload(payloadPath, productPayload);

  const productResult = runProjector(
    payloadPath,
    catalogPath,
    changelogPath,
    productCatalogPath,
    productChangelogPath,
  );
  if (productResult.status !== 0) {
    throw new Error(
      `Published product projection failed:\n${productResult.stdout}\n${productResult.stderr}`,
    );
  }

  const productCatalog = JSON.parse(await readFile(productCatalogPath, "utf8"));
  const productChangelog = JSON.parse(
    await readFile(productChangelogPath, "utf8"),
  );
  if (
    productCatalog.product.version !== "0.5.8" ||
    productCatalog.product.tag !== "product-v0.5.8" ||
    productCatalog.product.sourceTag !== "v0.5.8" ||
    productCatalog.product.assets[0].sha256 !== "c".repeat(64) ||
    productChangelog.releases.length !== 1 ||
    productChangelog.releases[0].entryDigest !== "a".repeat(64)
  ) {
    throw new Error("Product catalog/changelog projection is incomplete.");
  }

  const duplicateCatalogPath = path.join(temporaryRoot, "duplicate-catalog.json");
  const duplicateChangelogPath = path.join(
    temporaryRoot,
    "duplicate-changelog.json",
  );
  const duplicateResult = runProjector(
    payloadPath,
    productCatalogPath,
    productChangelogPath,
    duplicateCatalogPath,
    duplicateChangelogPath,
  );
  if (duplicateResult.status !== 0) {
    throw new Error("An exact duplicate release event was not idempotent.");
  }
  const duplicateChangelog = JSON.parse(
    await readFile(duplicateChangelogPath, "utf8"),
  );
  if (duplicateChangelog.releases.length !== 1) {
    throw new Error("An exact duplicate created a second history entry.");
  }

  productPayload.changelog.summary = "Conflicting published prose.";
  await writePayload(payloadPath, productPayload);
  const conflictResult = runProjector(
    payloadPath,
    productCatalogPath,
    productChangelogPath,
    duplicateCatalogPath,
    duplicateChangelogPath,
  );
  if (conflictResult.status === 0) {
    throw new Error("Conflicting prose for a published product version was accepted.");
  }

  productPayload.changelog.summary = "Makes product releases unattended.";
  productPayload.source.entryDigest = "not-a-digest";
  await writePayload(payloadPath, productPayload);
  const invalidDigestResult = runProjector(
    payloadPath,
    catalogPath,
    changelogPath,
    duplicateCatalogPath,
    duplicateChangelogPath,
  );
  if (invalidDigestResult.status === 0) {
    throw new Error("Invalid changelog digest was accepted.");
  }

  const pluginReleaseUrl =
    "https://github.com/termbrio/tbmp/releases/tag/v0.4.5";
  const pluginPayload = {
    schemaVersion: 1,
    eventKind: "plugins",
    channel: "preview",
    createdAt: "2026-08-04T21:00:00.0000000Z",
    source: {
      repository: "termbrio/tbmp",
      revision,
      tag: "v0.4.5",
      entryDigest: "b".repeat(64),
    },
    releaseUrl: pluginReleaseUrl,
    changelog: {
      schemaVersion: 1,
      component: "plugins",
      version: "0.4.5",
      channel: "preview",
      status: "ready",
      summary: "Updates provider integration.",
      changes: [
        {
          type: "changed",
          area: "team-relay",
          providers: ["codex", "claude"],
          text: "Documents unattended release handoff.",
        },
      ],
    },
    plugins: {
      releaseVersion: "0.4.5",
      codexVersion: "0.4.5+codex.20260804",
      claudeVersion: "0.4.5",
    },
  };
  await writePayload(payloadPath, pluginPayload);
  const pluginCatalogPath = path.join(temporaryRoot, "plugin-catalog.json");
  const pluginChangelogPath = path.join(temporaryRoot, "plugin-changelog.json");
  const pluginResult = runProjector(
    payloadPath,
    productCatalogPath,
    productChangelogPath,
    pluginCatalogPath,
    pluginChangelogPath,
  );
  if (pluginResult.status !== 0) {
    throw new Error(
      `Plugin projection failed:\n${pluginResult.stdout}\n${pluginResult.stderr}`,
    );
  }

  const pluginCatalog = JSON.parse(await readFile(pluginCatalogPath, "utf8"));
  const pluginChangelog = JSON.parse(
    await readFile(pluginChangelogPath, "utf8"),
  );
  if (
    pluginCatalog.plugins.codex.version !== "0.4.5+codex.20260804" ||
    pluginCatalog.plugins.claude.version !== "0.4.5" ||
    pluginChangelog.releases.length !== 2 ||
    pluginChangelog.releases[0].component !== "plugins" ||
    pluginChangelog.releases[0].changes[0].providers.length !== 2
  ) {
    throw new Error("Plugin catalog/changelog projection is incomplete.");
  }

  pluginPayload.plugins.claudeVersion = "0.4.4";
  await writePayload(payloadPath, pluginPayload);
  const mismatchedPluginResult = runProjector(
    payloadPath,
    productCatalogPath,
    productChangelogPath,
    duplicateCatalogPath,
    duplicateChangelogPath,
  );
  if (mismatchedPluginResult.status === 0) {
    throw new Error("Mismatched plugin release versions were accepted.");
  }

  process.stdout.write("release event projection tests passed\n");
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
