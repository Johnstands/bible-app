# Releasing

The app is built for Linux (an AppImage and a .deb). Installed copies check GitHub Releases for a newer version
when they start and offer to install it.

## One-time setup

Updates are signed, so an installed app only accepts a build made with your key.

1. The key pair is made with `npx tauri signer generate -w ~/.tauri/bible-app.key`. The **public** key is already in
   `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). The **private** key stays on your machine and must never be
   committed. Lose it and installed copies can no longer be updated: they would have to be reinstalled by hand.
2. In the GitHub repository, add two Actions secrets (Settings, Secrets and variables, Actions):
   - `TAURI_SIGNING_PRIVATE_KEY`: the contents of `~/.tauri/bible-app.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the key's password (empty if it has none)

## Making a release

1. Choose the new version and set it in three places, all the same: `package.json`, `src-tauri/Cargo.toml` and
   `src-tauri/tauri.conf.json`.
2. Commit, then tag and push: `git tag v0.2.0 && git push origin main v0.2.0`.
3. The **Release** workflow builds the Bible database once, creates a *draft* release, then builds Linux (AppImage and
   .deb), macOS (one universal .dmg for Intel and Apple Silicon) and Windows (an .exe installer) into it, with a single
   `latest.json` covering all three. It takes about 15 minutes.
4. Try the packages from the draft. When you are happy, publish the release: that is the moment installed copies
   start offering it.

To try the whole build without a version tag, run **Release** by hand (Actions > Release > Run workflow, or
`gh workflow run release.yml --ref <branch>`). It makes a draft called `build-test`; delete it afterwards.

To build locally instead:

```sh
npm run data:fetch && npm run data:build
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/bible-app.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" npm run tauri build
```

The packages appear in `src-tauri/target/release/bundle/`. The signing variables are needed because updates are
signed: without them the build stops after making the `.deb`.

### Building the AppImage on Arch Linux

linuxdeploy's GTK plugin expects a `gdk-pixbuf-2.0/2.10.0` directory that current Arch packages no longer have, and
stops with `cp: cannot stat ''`. Set `NO_STRIP=true`, and if the AppImage step still fails, guard the pixbuf step in
`~/.cache/tauri/linuxdeploy-plugin-gtk.sh` (skip the block that begins `Installing GDK PixBufs` when
`$gdk_pixbuf_binarydir` isn't a directory). The GitHub workflow builds on Ubuntu, where none of this applies, so
releases don't need it.

## If the update check does not find a release

The app asks `https://github.com/Johnstands/bible-app/releases/latest/download/latest.json`. GitHub only serves that
for a *published* release (not a draft), and only when the release has a `latest.json` asset, which the Release
workflow creates when the signing secrets are set. Settings shows "Couldn't check for updates" if it can't be reached.

## Release file names

The app's name has an apostrophe ("KJV Reader's Bible"). GitHub rewrites it when it stores a file, but tauri-action
doesn't expect that, so it can't match the `.sig` files and skips `latest.json` (the log says "Signature not found for
the updater JSON"). The workflow therefore sets `assetNamePattern`, and the files are named
`kjv-readers-bible_<version>_amd64.AppImage` and so on. Keep the product name out of that pattern.

## macOS and Windows

The Windows and macOS builds are made by CI and have not been run by the maintainer, so treat them as untested until
someone has installed them. They are not signed with an Apple or Windows certificate, so the first launch warns:

- **macOS:** the app is ad-hoc signed but not notarized. Open the .dmg, drag the app to Applications, then right-click
  it and choose Open (or run `xattr -dr com.apple.quarantine "/Applications/KJV Reader's Bible.app"`).
- **Windows:** SmartScreen says "Windows protected your PC". Choose More info, then Run anyway.

In-app updates use the same signed `latest.json` on every platform, and do not depend on those certificates.

Two things that only show up off Linux, both fixed once and worth remembering:

- **File names that differ only by case** (such as `settings.ts` and `Settings.tsx`) break the TypeScript build on macOS
  and Windows, whose filesystems ignore case. Keep module names distinct ignoring case.
- **The apostrophe in the product name** makes the Windows installer script (NSIS) fail, so
  `src-tauri/tauri.windows.conf.json` sets the product name to "KJV Readers Bible" there. Everywhere else, and in the
  window title, it is "KJV Reader's Bible".

## The AppImage on newer distributions

The AppImage bundles Wayland and epoxy libraries built for Ubuntu. On a newer system (Arch, for one) they clash with
the system's Mesa and WebKit aborts with `EGL_BAD_ALLOC`. `src-tauri/src/syslibs.rs` avoids this: when running from an
AppImage it restarts itself once with the system's copies preloaded. It does nothing outside an AppImage, or when the
system has none of those libraries. To check it after a release, run the AppImage plainly (no `LD_PRELOAD`):
`APPIMAGE_EXTRACT_AND_RUN=1 ./*.AppImage` on a machine without FUSE.

## What is checked on every push

The **CI** workflow runs the type check, the unit tests, the Rust tests (including the 100 ms search bar in a release
build) and the UI tests in headless Chrome. A second job compiles the app on Windows and macOS and runs the slide-import Rust
tests there, so code that only builds on those systems (the PowerPoint and Keynote converters in
`src-tauri/src/convert.rs`) is compiled before release day, not on it.
