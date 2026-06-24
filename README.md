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
schemas/*.schema.json         # JSON Schema contracts
scripts/*.ts                  # Validation and index generation
examples/*.plugin.json        # Example detail entries, not published to the registry
```

## Publishing Flow

1. Build, pack, and sign the plugin in the plugin's own repository.
2. Create a GitHub Release and upload:
   - `<id>-<version>.synergy-plugin.tgz`
   - `<id>-<version>.synergy-plugin.tgz.sig`
3. Add or update `plugins/<plugin-id>.json` in this repository.
4. Run:

```bash
bun install
bun run validate
bun run build-registry --check
```

5. Open a pull request. After CI and maintainer review pass, merging to `main` makes the plugin visible to Synergy clients.

## Artifact Requirements

Every published artifact must be an installable Synergy plugin package, not a source archive. The tarball must contain:

```text
plugin.json
runtime/index.js
integrity.json
permissions.summary.json
```

The entry must include a `sha256-...` integrity string and a signature metadata file. CI verifies the downloaded artifact hash, the required package files, the manifest name/version, and the signature payload hashes.
