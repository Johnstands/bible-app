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
3. The **Release** workflow builds the packages and attaches them, with `latest.json`, to a *draft* release.
4. Try the AppImage or .deb from the draft. When you are happy, publish the release: that is the moment installed
   copies start offering it.

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

## The AppImage on newer distributions

The AppImage bundles Wayland and epoxy libraries built for Ubuntu. On a newer system (Arch, for one) they clash with
the system's Mesa and WebKit aborts with `EGL_BAD_ALLOC`. `src-tauri/src/syslibs.rs` avoids this: when running from an
AppImage it restarts itself once with the system's copies preloaded. It does nothing outside an AppImage, or when the
system has none of those libraries. To check it after a release, run the AppImage plainly (no `LD_PRELOAD`):
`APPIMAGE_EXTRACT_AND_RUN=1 ./bible-app_*.AppImage` on a machine without FUSE.

## What is checked on every push

The **CI** workflow runs the type check, the unit tests, the Rust tests (including the 100 ms search bar in a release
build) and the UI tests in headless Chrome.
