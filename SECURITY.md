# Security

## Reporting a vulnerability

Please do not disclose vulnerabilities, credentials, or exploit details in a public issue. Use [GitHub's private vulnerability reporting](https://github.com/capi-git/aven/security/advisories/new) for this repository. Include the Aven version, operating system, affected component, reproduction steps, and the impact you observed.

If private reporting is unavailable, open an issue asking the maintainer for a private reporting channel, without including vulnerability details. There is no guaranteed response time; this is an independently maintained project.

## Scope and updates

Security fixes target the latest Aven release. Older releases are not maintained separately. Updates are distributed manually through [Aven Releases](https://github.com/capi-git/aven/releases); there is no automatic updater.

Aven runs locally installed agent CLIs. Those processes can read or modify project files and run commands according to their configuration and the selected access mode. A workspace profile is an organizational feature, not a sandbox or a separate credential store. Provider authentication, network requests, and billing are handled by the corresponding provider and CLI.

The initial macOS release is ad-hoc signed and is not Apple-notarized. Download builds only from this repository's releases, or build the source yourself. Do not submit secrets, private conversations, or unredacted environment files with a bug report.
