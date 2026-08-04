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
  changelogOnly = false,
) {
  const argumentsList = [
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
  ];
  if (changelogOnly) argumentsList.push("--changelog-only");
  return spawnSync(
    process.execPath,
    argumentsList,
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
  const originalProductPayload = structuredClone(productPayload);
  const payloadPath = path.join(temporaryRoot, "event.json");
  const productCatalogPath = path.join(temporaryRoot, "product-catalog.json");
  const productChangelogPath = path.join(
    temporaryRoot,
    "product-changelog.json",
  );
  await writePayload(payloadPath, productPayload);

  const candidatePayload = structuredClone(productPayload);
  candidatePayload.product.assets = [];
  const candidateCatalogPath = path.join(temporaryRoot, "candidate-catalog.json");
  const candidateChangelogPath = path.join(
    temporaryRoot,
    "candidate-changelog.json",
  );
  await writePayload(payloadPath, candidatePayload);
  const candidateResult = runProjector(
    payloadPath,
    catalogPath,
    changelogPath,
    candidateCatalogPath,
    candidateChangelogPath,
    true,
  );
  if (candidateResult.status !== 0) {
    throw new Error(
      `Candidate changelog projection failed:\n${candidateResult.stdout}\n${candidateResult.stderr}`,
    );
  }

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
  if (
    (await readFile(candidateChangelogPath, "utf8")) !==
      (await readFile(productChangelogPath, "utf8")) ||
    productChangelog.releases[0].version !== "0.5.8"
  ) {
    throw new Error(
      "The packaged candidate changelog does not contain or match the published release projection.",
    );
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

  const nextProductPayload = structuredClone(originalProductPayload);
  nextProductPayload.createdAt = "2026-08-05T20:30:00.0000000Z";
  nextProductPayload.source.tag = "v0.5.9";
  nextProductPayload.source.entryDigest = "d".repeat(64);
  nextProductPayload.release.tag = "product-v0.5.9";
  nextProductPayload.release.url =
    "https://github.com/termbrio/releases/releases/tag/product-v0.5.9";
  nextProductPayload.releaseUrl = nextProductPayload.release.url;
  nextProductPayload.product.version = "0.5.9";
  nextProductPayload.changelog.version = "0.5.9";
  nextProductPayload.changelog.summary = "Advances the product release.";
  const nextProductCatalogPath = path.join(
    temporaryRoot,
    "next-product-catalog.json",
  );
  const nextProductChangelogPath = path.join(
    temporaryRoot,
    "next-product-changelog.json",
  );
  await writePayload(payloadPath, nextProductPayload);
  const nextProductResult = runProjector(
    payloadPath,
    productCatalogPath,
    productChangelogPath,
    nextProductCatalogPath,
    nextProductChangelogPath,
  );
  if (nextProductResult.status !== 0) {
    throw new Error(
      `Next product projection failed:\n${nextProductResult.stdout}\n${nextProductResult.stderr}`,
    );
  }

  const replayProductCatalogPath = path.join(
    temporaryRoot,
    "replay-product-catalog.json",
  );
  const replayProductChangelogPath = path.join(
    temporaryRoot,
    "replay-product-changelog.json",
  );
  await writePayload(payloadPath, originalProductPayload);
  const historicalProductReplay = runProjector(
    payloadPath,
    nextProductCatalogPath,
    nextProductChangelogPath,
    replayProductCatalogPath,
    replayProductChangelogPath,
  );
  if (historicalProductReplay.status !== 0) {
    throw new Error("An exact historical product replay was not idempotent.");
  }
  const replayedProductCatalog = JSON.parse(
    await readFile(replayProductCatalogPath, "utf8"),
  );
  if (
    replayedProductCatalog.product.version !== "0.5.9" ||
    (await readFile(nextProductCatalogPath, "utf8")) !==
      (await readFile(replayProductCatalogPath, "utf8")) ||
    (await readFile(nextProductChangelogPath, "utf8")) !==
      (await readFile(replayProductChangelogPath, "utf8"))
  ) {
    throw new Error("Historical product replay regressed or rewrote the ledgers.");
  }

  const outOfOrderProductPayload = structuredClone(originalProductPayload);
  outOfOrderProductPayload.createdAt = "2026-08-06T20:30:00.0000000Z";
  outOfOrderProductPayload.source.tag = "v0.5.7";
  outOfOrderProductPayload.source.entryDigest = "e".repeat(64);
  outOfOrderProductPayload.release.tag = "product-v0.5.7";
  outOfOrderProductPayload.release.url =
    "https://github.com/termbrio/releases/releases/tag/product-v0.5.7";
  outOfOrderProductPayload.releaseUrl = outOfOrderProductPayload.release.url;
  outOfOrderProductPayload.product.version = "0.5.7";
  outOfOrderProductPayload.changelog.version = "0.5.7";
  await writePayload(payloadPath, outOfOrderProductPayload);
  const outOfOrderProductResult = runProjector(
    payloadPath,
    nextProductCatalogPath,
    nextProductChangelogPath,
    duplicateCatalogPath,
    duplicateChangelogPath,
  );
  if (outOfOrderProductResult.status === 0) {
    throw new Error("An out-of-order new product release was accepted.");
  }

  const wrongProductUrlPayload = structuredClone(nextProductPayload);
  wrongProductUrlPayload.release.url =
    "https://github.com/termbrio/releases/releases/tag/product-v9.9.9";
  wrongProductUrlPayload.releaseUrl = wrongProductUrlPayload.release.url;
  await writePayload(payloadPath, wrongProductUrlPayload);
  const wrongProductUrlResult = runProjector(
    payloadPath,
    productCatalogPath,
    productChangelogPath,
    duplicateCatalogPath,
    duplicateChangelogPath,
  );
  if (wrongProductUrlResult.status === 0) {
    throw new Error("A product release with the wrong URL identity was accepted.");
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
  const originalPluginPayload = structuredClone(pluginPayload);
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

  const nextPluginPayload = structuredClone(originalPluginPayload);
  nextPluginPayload.createdAt = "2026-08-05T21:00:00.0000000Z";
  nextPluginPayload.source.tag = "v0.4.6";
  nextPluginPayload.source.entryDigest = "f".repeat(64);
  nextPluginPayload.releaseUrl =
    "https://github.com/termbrio/tbmp/releases/tag/v0.4.6";
  nextPluginPayload.changelog.version = "0.4.6";
  nextPluginPayload.changelog.summary = "Advances the plugin release.";
  nextPluginPayload.plugins.releaseVersion = "0.4.6";
  nextPluginPayload.plugins.codexVersion = "0.4.6+codex.20260805";
  nextPluginPayload.plugins.claudeVersion = "0.4.6";
  const nextPluginCatalogPath = path.join(
    temporaryRoot,
    "next-plugin-catalog.json",
  );
  const nextPluginChangelogPath = path.join(
    temporaryRoot,
    "next-plugin-changelog.json",
  );
  await writePayload(payloadPath, nextPluginPayload);
  const nextPluginResult = runProjector(
    payloadPath,
    pluginCatalogPath,
    pluginChangelogPath,
    nextPluginCatalogPath,
    nextPluginChangelogPath,
  );
  if (nextPluginResult.status !== 0) {
    throw new Error(
      `Next plugin projection failed:\n${nextPluginResult.stdout}\n${nextPluginResult.stderr}`,
    );
  }

  const replayPluginCatalogPath = path.join(
    temporaryRoot,
    "replay-plugin-catalog.json",
  );
  const replayPluginChangelogPath = path.join(
    temporaryRoot,
    "replay-plugin-changelog.json",
  );
  await writePayload(payloadPath, originalPluginPayload);
  const historicalPluginReplay = runProjector(
    payloadPath,
    nextPluginCatalogPath,
    nextPluginChangelogPath,
    replayPluginCatalogPath,
    replayPluginChangelogPath,
  );
  if (historicalPluginReplay.status !== 0) {
    throw new Error("An exact historical plugin replay was not idempotent.");
  }
  const replayedPluginCatalog = JSON.parse(
    await readFile(replayPluginCatalogPath, "utf8"),
  );
  if (
    replayedPluginCatalog.plugins.claude.version !== "0.4.6" ||
    (await readFile(nextPluginCatalogPath, "utf8")) !==
      (await readFile(replayPluginCatalogPath, "utf8")) ||
    (await readFile(nextPluginChangelogPath, "utf8")) !==
      (await readFile(replayPluginChangelogPath, "utf8"))
  ) {
    throw new Error("Historical plugin replay regressed or rewrote the ledgers.");
  }

  const outOfOrderPluginPayload = structuredClone(originalPluginPayload);
  outOfOrderPluginPayload.createdAt = "2026-08-06T21:00:00.0000000Z";
  outOfOrderPluginPayload.source.tag = "v0.4.4";
  outOfOrderPluginPayload.source.entryDigest = "1".repeat(64);
  outOfOrderPluginPayload.releaseUrl =
    "https://github.com/termbrio/tbmp/releases/tag/v0.4.4";
  outOfOrderPluginPayload.changelog.version = "0.4.4";
  outOfOrderPluginPayload.plugins.releaseVersion = "0.4.4";
  outOfOrderPluginPayload.plugins.codexVersion = "0.4.4+codex.20260806";
  outOfOrderPluginPayload.plugins.claudeVersion = "0.4.4";
  await writePayload(payloadPath, outOfOrderPluginPayload);
  const outOfOrderPluginResult = runProjector(
    payloadPath,
    nextPluginCatalogPath,
    nextPluginChangelogPath,
    duplicateCatalogPath,
    duplicateChangelogPath,
  );
  if (outOfOrderPluginResult.status === 0) {
    throw new Error("An out-of-order new plugin release was accepted.");
  }

  const missingPluginUrlPayload = structuredClone(nextPluginPayload);
  missingPluginUrlPayload.releaseUrl = null;
  await writePayload(payloadPath, missingPluginUrlPayload);
  const missingPluginUrlResult = runProjector(
    payloadPath,
    pluginCatalogPath,
    pluginChangelogPath,
    duplicateCatalogPath,
    duplicateChangelogPath,
  );
  if (missingPluginUrlResult.status === 0) {
    throw new Error("A published plugin release with a null URL was accepted.");
  }

  process.stdout.write("release event projection tests passed\n");
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
