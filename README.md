# Termbrio releases

Public release assets and machine-readable release catalogs for Termbrio.

This repository does not contain the Termbrio product or marketplace source.
Large packages are attached to GitHub Releases; the `catalog/` directory records
the currently selected product and plugin releases.

Product and plugin versions advance independently:

- product tags: `product-vX.Y.Z`
- plugin tags: `plugins-vX.Y.Z`

Every published package is expected to have a SHA256 digest and provenance
pointing to the exact private source revision that produced it.
