# Releasing Dace

Releases are built by GitHub Actions (`.github/workflows/release.yml`) when a
version tag is pushed. Installed copies update themselves from the published
GitHub release, and every update is verified against Dace's updater key
before it is installed.

## One-time setup: the updater signing key

The updater key proves an update really came from you. It is separate from a
Windows code-signing certificate (see below).

1. Generate the key pair. Choose a password when prompted and keep it safe.
   Use a full path; shell variables such as `$env:USERPROFILE` only expand
   in PowerShell and are passed through literally by Command Prompt and Git
   Bash, which fails with "os error 123":

   ```powershell
   npm run tauri signer generate -- -w C:\Users\<you>\.tauri\dace-updater.key
   ```

   This writes the private key to `dace-updater.key` and the public key to
   `dace-updater.key.pub`. **Never commit the private key.** If it is lost,
   existing installs can no longer receive updates.

2. Put the public key in `src-tauri/tauri.conf.json`, replacing
   `REPLACE_WITH_DACE_UPDATER_PUBLIC_KEY` under `plugins.updater.pubkey`
   with the full contents of `dace-updater.key.pub`.

3. In the GitHub repository, go to **Settings → Secrets and variables →
   Actions** and add two repository secrets:

   - `TAURI_SIGNING_PRIVATE_KEY`: the full contents of `dace-updater.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the password you chose

## Cutting a release

1. Set the same version in `package.json`, `src-tauri/Cargo.toml` and
   `src-tauri/tauri.conf.json`.
2. Move the `[Unreleased]` notes in `CHANGELOG.md` under the new version.
3. Merge to `main` with CI green.
4. Tag and push:

   ```powershell
   git tag v0.1.0
   git push origin v0.1.0
   ```

5. The workflow runs the tests, builds the MSI and setup installers plus the
   signed update packages and `latest.json`, and creates a **draft** release.
6. Install the draft's installer on a clean machine, smoke-test it, then
   publish the release. Installed copies only see an update once it is
   published.

## Windows code signing (recommended before a public release)

Without a code-signing certificate, Windows SmartScreen warns that the
installer is from an unknown publisher. To remove the warning, buy an OV or
EV code-signing certificate (or use a cloud signing service such as Azure
Trusted Signing) and configure `bundle.windows` signing in
`src-tauri/tauri.conf.json` as described in the Tauri documentation on Windows
code signing.
