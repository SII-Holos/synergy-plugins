## Plugin Registry Change

### What changed?

- [ ] Added a new plugin entry
- [ ] Updated an existing plugin entry
- [ ] Yanked a version
- [ ] Updated registry tooling or documentation

### Review classification

- [ ] Third-party plugin submission
- [ ] Maintainer-owned official plugin submission
- [ ] Security-sensitive change
- [ ] Schema, CI, or registry tooling change

### Artifact checklist

- [ ] The plugin release includes an installable `.synergy-plugin.tgz`
- [ ] The release includes the matching `.sig`
- [ ] `downloadUrl` and `signatureUrl` are public
- [ ] `integrity`, `manifestHash`, and `permissionsHash` match the release artifact
- [ ] `signature.algorithm` is `ed25519`
- [ ] `signature.signer` matches the `.sig` signer
- [ ] `plugin.json.name`, registry id, entry filename, and signature `pluginId` are the same canonical plugin id
- [ ] `registry.json` was generated with `bun run build-registry`

### Trust labels

- [ ] I did not set `official: true` unless this plugin is maintained by SII Holos
- [ ] I did not set `verified: true` unless a maintainer explicitly asked for it
- [ ] I described any high-risk permissions in the PR body

### Validation

```bash
bun install
bun test
bun run build-registry
bun run validate
bun run build-registry --check
```
