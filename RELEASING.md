# Releasing Dace

Releases are built by GitHub Actions (`.github/workflows/release.yml`) when a
version tag is pushed. Installed copies update themselves from the published
GitHub release, and every update is checked against Dace's updater key before
it is installed.

## What a release contains

| Platform | Files |
|----------|-------|
| Windows | `.msi` installer, `-setup.exe` installer, signed update package |
| Linux | `.deb`, `.rpm`, `.AppImage`, signed update package |

Plus `latest.json`, the feed that installed copies read to find updates.

## The updater signing key

The updater key proves an update really came from this project. It is
separate from a Windows code-signing certificate (see below).

**Current setup:** the public key is already in `src-tauri/tauri.conf.json`
(`plugins.updater.pubkey`), and the private key and its password are stored
as the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Nothing needs doing for a normal release.

**Never commit the private key.** If it is lost, installed copies can no
longer be updated and users must reinstall manually.

### Creating or replacing the key

Only needed for a fresh fork or if the key is compromised.

1. Generate a key pair and choose a password when prompted. Use a full path:
   shell variables such as `$env:USERPROFILE` only expand in PowerShell, and
   Command Prompt or Git Bash pass them through literally ("os error 123").

   ```powershell
   npm run tauri signer generate -- -w C:\Users\<you>\.tauri\dace-updater.key
   ```

   This writes `dace-updater.key` (private) and `dace-updater.key.pub` (public).

2. Put the contents of `dace-updater.key.pub` into `plugins.updater.pubkey` in
   `src-tauri/tauri.conf.json`.

3. Store the private key and its password as repository secrets
   (**Settings → Secrets and variables → Actions**), for example with the
   GitHub CLI:

   ```powershell
   Get-Content C:\Users\<you>\.tauri\dace-updater.key -Raw | gh secret set TAURI_SIGNING_PRIVATE_KEY --repo arcaenux/dace
   ```

   ```powershell
   gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo arcaenux/dace
   ```

## Cutting a release

1. Set the same version in `package.json`, `src-tauri/Cargo.toml` and
   `src-tauri/tauri.conf.json`.
2. In `CHANGELOG.md`, move the `[Unreleased]` notes under a new heading for
   that version and date.
3. Merge to `main` once CI is green on Windows and Linux.
4. Tag `main` and push the tag:

   ```powershell
   git tag v0.1.0
   ```

   ```powershell
   git push origin v0.1.0
   ```

5. The Release workflow runs the tests on both platforms, builds the files
   listed above, and creates a **draft** GitHub release named after the
   version.
6. Install the draft's installer on a clean machine, smoke-test it, then
   **Publish** the release. Installed copies only see an update once it is
   published.

Local builds (`npm run tauri build`) produce installers but no signed update
packages, so they never need the private key. Update packages are only made
in CI, through `src-tauri/tauri.release.conf.json`.

## Windows code signing (before a public release)

Without a code-signing certificate, Windows SmartScreen warns that the
installer comes from an unknown publisher. To remove the warning, get an OV
or EV code-signing certificate, or use a cloud signing service such as Azure
Trusted Signing, and configure `bundle.windows` signing in
`src-tauri/tauri.conf.json` as described in the Tauri documentation on Windows
code signing.
