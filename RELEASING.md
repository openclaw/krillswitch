# Releases

Application source releases use signed annotated `vX.Y.Z` tags and
`.github/workflows/release.yml`. The workflow validates dated `CHANGELOG.md`
notes, a matching root `package.json` version, and green push CI on the exact
protected-main commit, runs checks, and
publishes the source archive with SHA256SUMS. It never deploys the service.

SDK releases keep the public `sdk-vX.Y.Z` namespace and use
`.github/workflows/npm-release.yml`. Keep core and React package versions in
lockstep and finalize `SDK_CHANGELOG.md`. Push an SSH-signed annotated SDK tag
after green push CI. The workflow packs and verifies both SDKs, publishes the
retained tarballs through npm OIDC, and creates a GitHub Release with the same
tarballs, checksums and changelog notes. Existing npm versions are refused.
The private CLI remains unpublished. Trusted publisher registrations name
`npm-release.yml`, `openclaw/krillswitch` and environment `npm-release`.

Both workflows support dispatch from main with `dry_run=true` by default.
Rehearsals run validation and packaging without tags, releases or npm writes.
Publishing requires a tag push and separate explicit release authorization.
Allowed SSH signers live in `.github/release-allowed-signers`.
