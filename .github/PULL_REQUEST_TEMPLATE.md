## Plugin Registry Change

### What changed?

- [ ] Added a new plugin entry
- [ ] Updated an existing plugin entry
- [ ] Yanked a version
- [ ] Updated registry tooling or documentation

### Artifact checklist

- [ ] The plugin release includes an installable `.synergy-plugin.tgz`
- [ ] The release includes the matching `.sig`
- [ ] `downloadUrl` and `signatureUrl` are public
- [ ] `integrity`, `manifestHash`, and `permissionsHash` match the release artifact
- [ ] `registry.json` was generated with `bun run build-registry`

### Validation

```bash
bun install
bun run validate
bun run build-registry --check
```
