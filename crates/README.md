# Native runtime

Rust crates implementing the native Calyx runtime against
[`ABI v1.6`](../docs/ABI.md). The executable regression authority is the
[`conformance suite`](../conformance/README.md).

- [`core/`](core/) — the ABI host, framebuffer, palette, input,
  font, cart loading, and system-cart privilege surface; passes the
  conformance suite.
- [`cli/`](cli/) — the `calyx` binary: `run`
  (headless dump + terminal/window presenters), `watch` hot-reload,
  `console` boot-to-launcher, and `verify`/`bless` (the conformance
  harness).

Run commands from the Calyx repository root (the directory containing
`Cargo.toml`). Install Rust 1.95 or newer and Cargo first. The conformance cart build also
requires Python 3.11+, Node.js 20+, and npm 10+; its runner installs the pinned
AssemblyScript compiler when necessary.

```sh
cargo test --workspace
cargo run -p calyx-cli -- --help
```

The default CLI features are `window` and `audio`. For a portable SDL build,
install a C/C++ toolchain and CMake, then run:

```sh
cargo build --release -p calyx-cli --no-default-features --features sdl-bundled
```

A minimal headless or terminal build uses `--no-default-features`. See the
[CLI README](cli/README.md) for presenter commands.
