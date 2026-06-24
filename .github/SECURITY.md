# Security Policy

The `SII-Holos/synergy-plugins` repository is the official Synergy Plugin
Market registry. Treat registry changes as supply-chain sensitive.

## Reporting A Vulnerability

Do not open a public issue for a malicious plugin, compromised artifact,
incorrect signer, leaked signing key, or registry bypass.

Use GitHub private vulnerability reporting for this repository. If private
reporting is unavailable, contact a repository maintainer directly and include:

- affected plugin id and version
- registry entry URL or pull request
- release artifact URL
- expected impact
- recommended mitigation, if known

## Emergency Yank

Maintainers may merge an emergency PR that adds an affected version to
`yankedVersions` or removes a compromised release from the generated index.
Emergency yanks still run registry validation, but may use expedited review.

## Supported Surface

Security review covers this registry, schemas, validation scripts, official
metadata, artifact integrity, and signer metadata. Individual third-party plugin
source repositories remain the responsibility of their authors unless the plugin
is marked `official`.
