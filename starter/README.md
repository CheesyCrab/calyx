# Your first Calyx cart

The extracted starter ZIP is a small, self-contained starting point for a Calyx cart. It
needs Node.js 20 or newer and npm 10 or newer to build. You do not need Git, Rust,
Python, a Calyx source checkout, or a GitHub account for that step. Until the
hosted player is available, playing it in a browser needs a locally served Calyx
player; see the source repository’s `docs/RUNNING.md`.

From the extracted starter folder, install the pinned AssemblyScript compiler:

```sh
npm install
```

Open `cart.ts`, search for `CUSTOMIZE`, and change the title or colors. Build
after each edit:

```sh
npm run build
```

The command writes `cart.wasm` in this folder. Open the Calyx browser player (locally served until the hosted player is available),
choose **Upload**, read the short local-cart explanation, and select that file. The player reads it from this
device and does not upload or remember it. Rebuild and choose the same file to
try the next version.

`sunny/` is the pinned Calyx authoring SDK used by this starter. Its source is
included so the build has no unpublished package dependency. `npm install` downloads AssemblyScript
and its compiler dependencies.

The starter example and Sunny code are provided under the MIT license in
`LICENSES/MIT.txt`. Font metrics derived from m6x11 by Daniel Linssen retain
the upstream attribution terms recorded in `NOTICES.txt`. Before distributing your own cart, choose a license for
your original code and add it to `cart.toml`. Loading a cart into Calyx does
not determine that license.

The local player accepts ordinary ABI v1 carts with a declared memory ceiling.
This starter supplies the supported 64 MiB ceiling automatically. It starts
with indexed color at 320×240. The included Sunny API also supports opting
into true color, alpha blending, clipping, and sprite regions. PNG artwork
must be converted to embedded pixel data at build time; the cart has no runtime
filesystem or PNG decoder. See the Calyx cart-authoring guide for the full API,
deterministic verification, art conversion, native presenters, and catalog
packaging.

For source contributors: this template gains `sunny/`, licenses, and notices
when `python3 tools/starter_package.py` runs from the Calyx root. Build and
extract that ZIP before following these steps.
