# Synergy Plugin Market Registry

This repository is the public, GitHub-backed registry for Synergy plugins. It does not host plugin source code and it does not run a backend service. Each plugin stays in its own repository and publishes installable `.synergy-plugin.tgz` release artifacts. This repository only stores reviewed metadata that Synergy clients can read directly from GitHub raw URLs.

The canonical public index is:

```text
https://raw.githubusercontent.com/SII-Holos/synergy-plugins/main/registry.json
```

## Structure

```text
registry.json                 # Generated lightweight index for list/search views
plugins/<plugin-id>.json      # Reviewed plugin detail entries
icons/<plugin-id>.svg         # Reviewed marketplace SVG icons
schemas/*.schema.json         # JSON Schema contracts
scripts/*.ts                  # Validation and index generation
examples/*.plugin.json        # Example detail entries, not published to the registry
```

## Publishing Flow

The recommended path is:

```bash
synergy-plugin publish-market --repo https://github.com/owner/my-plugin
```

The command validates, builds, packs, signs, uploads GitHub Release assets when possible, writes the registry entry, regenerates `registry.json`, validates this registry, and opens or prepares a pull request.

Manual publishing is also supported:

1. Build, pack, and sign the plugin in the plugin's own repository.
2. Create a GitHub Release and upload:
   - `<id>-<version>.synergy-plugin.tgz`
   - `<id>-<version>.synergy-plugin.tgz.sig`
3. Add or update `plugins/<plugin-id>.json` in this repository. Each version must include `signature.algorithm: "ed25519"` and `signature.signer` from the `.sig` file.
4. If the plugin uses a custom marketplace icon, add `icons/<plugin-id>.svg` and set `icon` to `{ "type": "registry-svg", "path": "icons/<plugin-id>.svg" }`.
5. Run:

```bash
bun install
bun run build-registry
bun run validate
bun run build-registry --check
```

6. Open a pull request. After CI and maintainer review pass, merging to `main` makes the plugin visible to Synergy clients.

See [REVIEW_POLICY.md](REVIEW_POLICY.md) for maintainer review rules, trust labels, and merge requirements.

## Artifact Requirements

Every published artifact must be an installable Synergy plugin package, not a source archive. The tarball must contain:

```text
plugin.json
runtime/index.js
integrity.json
permissions.summary.json
```

The entry must include a `sha256-...` integrity string, a signature metadata URL, and the signer public key. CI verifies the downloaded artifact hash, the required package files, the manifest name/version, signature payload hashes, and the Ed25519 signature using the registry-reviewed signer.

## Marketplace Icons

Registry icons are reviewed assets. Use a Lucide token for simple entries:

```json
{ "type": "lucide", "name": "image" }
```

Use a custom SVG when the plugin needs a recognizable brand mark:

```json
{ "type": "registry-svg", "path": "icons/my-plugin.svg" }
```

Custom icons must live in `icons/<plugin-id>.svg`, be 32 KB or smaller, and avoid scripts, `foreignObject`, event handlers, embedded images, external URLs, data URLs, and executable references.

## Security

Do not open public issues for malicious plugins, compromised artifacts, incorrect signers, leaked signing keys, or registry bypasses. Use the private reporting flow described in [.github/SECURITY.md](.github/SECURITY.md).
