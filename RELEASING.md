# Releasing DroidSync

Releases live on GitHub Releases for `amahasin/DroidSync`. The installed app checks that page
(Settings → This app → Check for updates) through electron-updater.

## Make a release

1. Set the new version in `package.json` (for example `0.1.0`).
2. Run `npm run build:win`. It checks types, builds, and writes to `dist/`:
   - `DroidSync-0.1.0-setup.exe`
   - `DroidSync-0.1.0-setup.exe.blockmap`
   - `latest.yml`
3. On GitHub, create a release with the tag `v0.1.0` and upload those three files. The updater reads
   `latest.yml`, so it must be on the release along with the setup file.
4. Publish it. A draft or pre-release is not offered as an update.

To let electron-builder do the upload, set a `GH_TOKEN` with write access to the repo and run
`npx electron-builder --win --publish always` instead of step 2 and 3. Do not put the token in the repo.

## Good to know

- The repository has to be public for installed apps to see the release. A private repository would need
  a token inside the app, which must not be shipped.
- Updating only works for an installed copy (the setup file). A development build and the
  `dist/win-unpacked` folder report "This build does not check for updates."
- Until a code-signing certificate is set up the build is unsigned and SmartScreen warns on first run. To
  sign, set `CSC_LINK` (path to the .pfx) and `CSC_KEY_PASSWORD` in the environment before building.
- Test an update by installing the older version, publishing the newer one, and using Check for updates.
