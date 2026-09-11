# Contributing to Calyx

Bug fixes, clearer docs, small carts, and good tests are all welcome. Calyx is
intentionally small, so keep each change focused enough that another person can
understand what it does and why it belongs here.

Support depends on maintainer time. There is no public roadmap or schedule to
plan around. The 1.0 release targets are the hosted
browser/PWA player, Linux x86_64 archive and Flatpak, Windows x86_64 ZIP, and
macOS arm64 application/archive. Source builds may work elsewhere; see
[Running Calyx](docs/RUNNING.md) for the supported paths.

Before tackling a large feature, discuss it first. Portability repairs,
conformance improvements, and contained cart contributions fit well here.
General-engine features, account or storefront systems, and speculative
platform layers are outside 1.0's scope. A useful idea can still be too much
for this little console to maintain.

Report suspected vulnerabilities privately through the [security policy](SECURITY.md), not in a public issue or pull request.

## Prerequisites

Install these tools before you start:

- Rust 1.95 or newer and Cargo
- Node.js 20 or newer and npm 10 or newer
- Python 3.11 or newer
- Native build tools and platform libraries from the
  [CLI prerequisites](crates/cli/README.md#build-prerequisites); SDL builds also
  need CMake and a C/C++ toolchain

Install the web dependencies before running the verification gates:

```sh
npm ci --prefix web --no-audit --no-fund
```

Browser verification also needs Chromium. From `web/`, run
`npx playwright install chromium`.

Run all repository commands from the Calyx root unless a command says
otherwise. Cart and conformance builds install their pinned npm dependencies
when their supported runners need them.

## Make a change

1. Read [Calyx Architecture](docs/ARCHITECTURE.md) and the component README for
   the directory you will change.
2. Read [the ABI](docs/ABI.md) before changing cart-visible behavior.
3. Add a failing behavioral test before implementation changes.
4. Make the smallest change that satisfies the test.
5. Update current documentation when an interface or supported command changes.

Do not change the ABI as an incidental implementation detail. An observable
cart-contract change needs an explicit ABI version decision, matching native
and web implementations, conformance vectors, and a changelog entry in the
same change.

## Verify the change

The normal local commit-readiness command is:

```sh
python3 tools/dev.py commit
```

It checks cart metadata, Rust formatting, the generated Sunny font, Python
tools, the conformance harness, the Rust workspace, native conformance, web
unit tests, and web conformance.

Use a narrower command while iterating:

```sh
python3 tools/dev.py cart <cart-name>
python3 tools/dev.py --dry-run commit
python3 tools/public_check.py --root .
```

Maintainers use the broader release-level gate before release artifacts are
accepted:

```sh
python3 tools/dev.py release
```

This adds SDL tests, the public-cart soak, browser smoke, touch journeys, and
local web/native package verification. It does not publish, deploy, tag,
commit, or push.

## Cart contributions

Use [the cart authoring guide](docs/CART_AUTHORING.md). A cart contribution
must declare its whole-work license and preserve any required third-party
source, license, or attribution facts beside the material that needs them.

`public_source = true` is repository contribution metadata. Set it only when
the cart is intended to remain in the maintained public source tree.
`release = true` is a separate player-catalog decision.

## Issues and changes

Before proposing a large change, check the current architecture and scope documents. A good report names the source revision, platform and presenter, expected behavior, observed behavior, and the smallest reproducible input or cart. A good change explains one behavior, carries its verification, and updates the current documentation that behavior affects.

Please be patient with issues and pull requests. Reviews happen when maintainer
time permits, and a feature request is an invitation to discuss rather than a
promise to build.

## AI-assisted contributions

Contributors remain responsible for understanding, reviewing, licensing, and
explaining everything they submit. Disclose substantial tool-generated code,
text, images, audio, or data in the contribution description. Assisted
material follows the same quality, provenance, and licensing requirements as
other material. See [AI Use](docs/AI_USE.md) for the project disclosure.

## Licensing

By contributing, you must have the right to submit the material under the
license declared by its component. See [LICENSE.md](LICENSE.md). Do not add
third-party content without the notices or source information its license
requires.
