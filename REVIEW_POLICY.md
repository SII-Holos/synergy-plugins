# Official Plugin Market Review Policy

`SII-Holos/synergy-plugins` is the canonical source for Synergy's Official
Plugin Market. Merging a plugin entry makes that plugin visible to Synergy
clients and records the reviewed signer used for installation verification.

## Merge Requirements

Every change to `main` must go through a pull request.

Required before merge:

- `validate` status check passes
- at least one CODEOWNERS approval
- all conversations resolved
- branch is up to date with `main`
- registry drift check passes

Schema, workflow, validation script, and trust-policy changes require review by
a core maintainer.

## Plugin Entry Review

Reviewers must verify:

- plugin id, entry filename, manifest identity (`id` for API3/API4, `name` for historical API2 artifacts), and signature `pluginId` match
- `downloadUrl` and `signatureUrl` point to public release assets
- artifact integrity matches `sha256-...`
- the `.sig` signer matches `versions[].signature.signer`
- Ed25519 signature verification passes in CI
- API/host compatibility and the natural-language access summary match the packaged manifest
- package contains installable runtime assets, not a source-only archive

## Trust Labels

`official: true` means the plugin is maintained by SII Holos.

`verified: true` means maintainers have reviewed the author identity and release
source. Third-party authors should not grant either flag in their own PRs.

Access-bearing changes receive normal maintainer review. The registry does not assign an overall low/medium/high rating to a plugin.

## Auto-Merge

Maintainers may enable GitHub auto-merge after required review and checks are in
place. The repository must not automatically merge third-party submissions based
only on CI success.
