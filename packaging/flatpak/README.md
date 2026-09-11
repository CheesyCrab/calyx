# Calyx Flatpak

This directory defines the Linux x86_64 Flatpak for Cheesy Crab Calyx. The
manifest performs a source build with the Freedesktop 25.08 platform and SDK,
the matching Rust SDK extension, offline Cargo sources, and the bundled SDL
presenter.

## Prepare the product input

Use a Linux x86_64 build host with Flatpak, `flatpak-builder`, Python 3,
Node.js, and npm installed. Install the Freedesktop 25.08 platform and SDK
and the matching Rust SDK extension before building. Run source commands from
the Calyx repository root:

```sh
python3 tools/catalog.py flatpak-input --profile release
```

This builds the curated catalog and stages product and desktop-integration
files under `build/flatpak/input/`. The manifest consumes that exact staging
directory.

After `Cargo.lock` changes, regenerate `cargo-sources.json` with the official
Flatpak Builder Tools Cargo generator:

```sh
flatpak-cargo-generator.py Cargo.lock \
  -o packaging/flatpak/cargo-sources.json
```

Build the staged application with:

```sh
flatpak-builder build/flatpak/work packaging/flatpak/org.cheesycrab.Calyx.yml
```

Use a new or empty build directory. The manifest validates the desktop file
and AppStream metadata during the build. It compiles the CLI with
`--no-default-features --features sdl-bundled`.

## Verify a bundle

For a trusted bundle built from the staged input, run:

```sh
python3 tools/catalog.py verify-flatpak \
  build/distributions/calyx-1.0.0-rc.1-linux-x86_64.flatpak
```

The verifier imports the bundle into a temporary user installation, checks the
installed metadata, runs `calyx --version`, proves the fixed 100-frame
boot-to-launcher handoff, and writes adjacent checksum and verification-receipt
files. Verification executes the installed binary, so do not use it on an
untrusted bundle.

Install a trusted bundle for interactive use with:

```sh
flatpak install --user ./calyx-1.0.0-rc.1-linux-x86_64.flatpak
flatpak run org.cheesycrab.Calyx
```

Remove it with `flatpak uninstall --user org.cheesycrab.Calyx`.

## Sandbox contract

The application receives Wayland or fallback X11 display access, PulseAudio,
GPU access, and controller-input device access. It does not receive network,
home-directory, or host-filesystem access.

The Flatpak is a real SDK source build, not a wrapper around the Linux native
archive. It installs the application under `org.cheesycrab.Calyx` and uses the
same release catalog and ABI v1.6 runtime as the other player packages.
