# Repository Guidelines

## Scope

This public repository is Termbrio's distribution ledger. Product GitHub
Release assets hold ZIP, tarball, APK, checksum, manifest, installer, and guide
files. Small machine-readable catalog files under `catalog/` are updated by
release automation.

No product or marketplace source code belongs here.

## Mutation Rules

Humans may edit documentation and schemas. Product and plugin version entries
are automation-owned. Large artifacts must never be committed to Git history.

Product and plugin versions are independent. Public product releases use the
`product-vX.Y.Z` namespace in this repository. Plugin contents and `vX.Y.Z`
release records remain in `termbrio/tbmp`; the catalog stores their source
revision and release URL without duplicating plugin assets here.

## Validation

```powershell
node scripts/validate-catalog.mjs
```

Catalog entries must identify their source repository, tag, revision, and
release URL. Every published product asset must have a recorded size and SHA256
digest.

## Security

This repository is public. Never store credentials, private source archives,
signing keys, GitHub App private keys, or private operational notes.
