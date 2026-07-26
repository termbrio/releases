# Repository Guidelines

## Scope

This public repository is Termbrio's distribution ledger. GitHub Release assets
hold ZIP, tarball, APK, checksum, and manifest files. Small machine-readable
catalog files under `catalog/` are updated by release automation.

No product or marketplace source code belongs here.

## Mutation Rules

Humans may edit documentation and schemas. Product and plugin version entries
are automation-owned. Large artifacts must never be committed to Git history.

Product and plugin versions are independent. Tags use separate namespaces such
as `product-v0.5.5` and `plugins-v0.4.3`.

## Validation

```powershell
node scripts/validate-catalog.mjs
```

Catalog entries must identify their source repository/tag/revision and every
published asset must have a recorded size and SHA256 digest.

## Security

This repository is public. Never store credentials, private source archives,
signing keys, GitHub App private keys, or private operational notes.
