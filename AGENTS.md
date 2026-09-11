# Calyx — Working in This Tree

Read [README.md](README.md) for the product, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
for the implementation boundaries, and [docs/ABI.md](docs/ABI.md) for the
normative cart/runtime contract.

## Repository shape

Calyx has two sides divided by the ABI:

- Guest carts are AssemblyScript WebAssembly modules that compile Sunny from
  `sdk/` into the cart. Maintained carts live in `carts/`.
- Host runtimes are peers. The native Rust implementation lives in `crates/`;
  the JavaScript implementation and browser player live in `web/`. They share
  the ABI specification and conformance fixtures, never runtime code.

`starter/` owns the permissive source template for the downloadable Node-only
first-cart ZIP. Release packaging adds the canonical `sdk/assembly` snapshot;
do not maintain a second copied Sunny tree there.

The active cross-runtime oracle is `conformance/`. Every supported runtime must
reproduce its expected framebuffer hashes, event streams, and faults.

## Current contract

Calyx implements ABI v1.6. Simulation advances at exactly 60 ticks per second.
The native runtime, web runtime, Sunny, system carts, player catalogs,
presenters, and conformance suite implement that contract.

## Invariants

1. **Determinism is product behavior.** A cart's `update()` depends only on its
   frame, input, and cart state. It has no wall clock or host random source.
   Integers remain the default. Finite-domain guest-side `f64` must follow
   [docs/FLOAT_POLICY.md](docs/FLOAT_POLICY.md).
2. **Every host import is parity surface.** An import, draw semantic, font
   change, or hash change must land byte-identically in native and web with
   conformance coverage. Prefer guest-side Sunny code for behavior that lowers
   to existing imports.
3. **Verify intent; present output.** Verified state is the framebuffer
   plus per-frame input, audio intent, system intent, traces, and faults.
   Windows, speakers, terminals, SDL, and browser canvases are unverified
   presenters.
4. **Do not expand the ABI incidentally.** Persistence, networking, raw
   framebuffer access, host math, and other unsupported behavior require an
   explicit contract decision and ABI versioning.
5. **System carts are ordinary carts with explicit privilege.** Only carts
   approved as system carts may link `calyx.sys`. Do not add privileged imports
   that launcher or settings behavior does not require.
6. **The ABI document is present tense.** It defines current behavior, current
   unsupported behavior, and a factual changelog. Do not put project plans or
   speculative product commitments in it.

## Development workflow

Use the cross-platform Python workflows from the repository root:

```sh
python3 tools/dev.py cart <name>    # metadata check and one cart build
python3 tools/dev.py commit         # normal commit-readiness gate
python3 tools/dev.py release        # full local release-level gate
python3 tools/dev.py --dry-run commit
```

The named workflows do not commit, push, deploy, publish, tag, or change serving
infrastructure.

For implementation changes:

- add a behavioral test first and observe the expected failure;
- keep diffs focused;
- run the directly affected test while iterating;
- run `python3 tools/dev.py commit` before handoff;
- run `python3 tools/public_check.py --root .` after public documentation
  changes;
- do not re-bless conformance output until the semantic change is understood.

`calyx verify` grades the whole suite; it does not filter one fixture. Browser
journey tests are for durable launcher, input, and shell contracts, not every
new cart.

## Cart layout

Product cart source directories are lowercase kebab-case under `carts/`.
Privileged console UI lives under `carts/system/`; maintained authoring examples
live under `carts/examples/`.

Every public cart manifest sets `public_source = true`. This field is repository
contribution metadata: it says the cart is maintained in the public source
tree. `release = true` separately selects the curated player catalog. System
and release carts must be public source; examples may be public without joining
the release catalog.

Every cart README is self-contained. It must describe the cart's current
purpose, controls, behavior, verification, provenance, and known limits without
requiring a project plan or history document.

## Documentation

The public repository documentation is:

```text
README.md
CHANGELOG.md
CONTRIBUTING.md
LICENSE.md
SECURITY.md
docs/README.md
docs/RUNNING.md
docs/CART_AUTHORING.md
docs/ARCHITECTURE.md
docs/ABI.md
docs/VERSIONING.md
docs/AI_USE.md
docs/FLOAT_POLICY.md
```

Keep component documentation with its owner in `sdk/`, `web/`, `crates/`,
`carts/`, `conformance/`, `packaging/`, or `assets/`. The ABI-pinned font is
machine data at `assets/fonts/m6x11-v1.json`; `docs/` contains prose only.

Write player and author procedures with short direct sentences, prerequisites
before commands, stable terms, and one action per step. Preserve exact API,
ABI, command, and contract language.

## Licensing and assisted work

Follow [LICENSE.md](LICENSE.md) and keep required source, license, and
attribution facts beside third-party material. Follow
[docs/AI_USE.md](docs/AI_USE.md) for assisted-development disclosure and
runtime-privacy facts.
