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
const temporaryRoot = await mkdtemp(
  path.join(os.tmpdir(), "termbrio-release-event-"),
);

function runProjector(payloadPath, outputPath) {
  return spawnSync(
    process.execPath,
    [
      projectorPath,
      "--payload",
      payloadPath,
      "--catalog",
      catalogPath,
      "--output",
      outputPath,
    ],
    { encoding: "utf8" },
  );
}

try {
  const revision = "0123456789abcdef0123456789abcdef01234567";
  const releaseUrl =
    "https://github.com/termbrio/releases/releases/tag/product-v0.5.5";
  const payload = {
    schemaVersion: 1,
    eventKind: "product",
    channel: "pilot",
    createdAt: "2026-07-26T20:30:00.0000000Z",
    source: {
      repository: "termbrio/tb",
      revision,
      tag: "product-v0.5.5",
    },
    releaseUrl,
    product: {
      version: "0.5.5",
      assets: [
        {
          name: "termbrio-dev-win-x64.zip",
          kind: "package",
          platform: "windows",
          runtime: "win-x64",
          size: 12345,
          sha256: "A".repeat(64),
        },
      ],
    },
  };
  const payloadPath = path.join(temporaryRoot, "event.json");
  const outputPath = path.join(temporaryRoot, "catalog.json");
  await writeFile(payloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const success = runProjector(payloadPath, outputPath);
  if (success.status !== 0) {
    throw new Error(
      `Published event projection failed:\n${success.stdout}\n${success.stderr}`,
    );
  }

  const projected = JSON.parse(await readFile(outputPath, "utf8"));
  if (
    projected.product.version !== "0.5.5" ||
    projected.product.releaseUrl !== releaseUrl ||
    projected.product.assets.length !== 1 ||
    projected.product.assets[0].sha256 !== "a".repeat(64)
  ) {
    throw new Error("Published product asset inventory was not projected.");
  }

  payload.product.assets[0].sha256 = "not-a-digest";
  await writeFile(payloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const invalid = runProjector(payloadPath, outputPath);
  if (invalid.status === 0) {
    throw new Error("Invalid product asset digest was accepted.");
  }

  const pluginReleaseUrl =
    "https://github.com/termbrio/tbmp/releases/tag/v0.4.3";
  const pluginPayload = {
    schemaVersion: 1,
    eventKind: "plugins",
    channel: "pilot",
    createdAt: "2026-07-27T00:00:00.0000000Z",
    source: {
      repository: "termbrio/tbmp",
      revision,
      tag: "v0.4.3",
    },
    releaseUrl: pluginReleaseUrl,
    plugins: {
      releaseVersion: "0.4.3",
      codexVersion: "0.4.3+codex.20260727",
      claudeVersion: "0.4.3",
    },
  };
  await writeFile(
    payloadPath,
    `${JSON.stringify(pluginPayload, null, 2)}\n`,
    "utf8",
  );

  const pluginSuccess = runProjector(payloadPath, outputPath);
  if (pluginSuccess.status !== 0) {
    throw new Error(
      `Plugin event projection failed:\n${pluginSuccess.stdout}\n${pluginSuccess.stderr}`,
    );
  }

  const pluginProjected = JSON.parse(await readFile(outputPath, "utf8"));
  if (
    pluginProjected.plugins.codex.version !==
      "0.4.3+codex.20260727" ||
    pluginProjected.plugins.claude.version !== "0.4.3" ||
    pluginProjected.plugins.codex.tag !== "v0.4.3" ||
    pluginProjected.plugins.codex.releaseUrl !== pluginReleaseUrl ||
    pluginProjected.plugins.claude.releaseUrl !== pluginReleaseUrl
  ) {
    throw new Error("Published plugin release metadata was not projected.");
  }

  pluginPayload.plugins.claudeVersion = "0.4.2";
  await writeFile(
    payloadPath,
    `${JSON.stringify(pluginPayload, null, 2)}\n`,
    "utf8",
  );
  const mismatchedPlugin = runProjector(payloadPath, outputPath);
  if (mismatchedPlugin.status === 0) {
    throw new Error("Mismatched plugin release versions were accepted.");
  }

  process.stdout.write("release event projection tests passed\n");
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
