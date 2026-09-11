# Calyx licensing

Calyx is a collection of independently licensed components. Distribution in
one repository, catalog, web player, or native archive does not replace those
component licenses.

## Runtime and player

The native Calyx runtime (`crates/core` and `crates/cli`) and the web runtime
and player (`web`) are licensed under **LGPL-3.0-or-later**. Calyx carts are
independently authored WebAssembly modules loaded through the published Calyx
ABI. The runtime license does not prescribe a cart's license.

## Authoring SDK

Sunny (`sdk`) is licensed under **MIT OR Apache-2.0**, at the recipient's
option. Sunny guest-side code compiles into a cart, so this permissive license
lets cart authors choose the license for their own work.

The original example and build-helper files under `starter/` are licensed
under **MIT**. Release starter ZIPs include those files and a pinned Sunny
source snapshot distributed under Sunny's MIT option. These licenses cover the
provided scaffold and SDK; they do not prescribe the license of an author's
new cart code. Authors choose and record their whole-cart license before
distribution.

## First-party carts

Unless a cart says otherwise in its own manifest and notices, first-party carts
under `carts/` are licensed under **GPL-3.0-or-later**. A cart's declared license
applies to all original material contained in that cart, including source code,
text, art, audio, generated data, and the compiled Wasm. Third-party material,
when present, retains its own license and must be identified by that cart.

Third-party cart authors choose their own licenses. Loading a cart through the
Calyx ABI does not change that license.

## Tools, specifications, and documentation

Build, catalog, conformance, packaging, and repository-maintenance software is
licensed under **GPL-3.0-or-later** unless its component says otherwise.

Technical specifications and software documentation in this repository may be
used under **GPL-3.0-or-later** as part of the corresponding software source.

## Third-party font

Calyx includes bitmap glyphs derived from **m6x11 by Daniel Linssen**.
The creator makes the font free to use with attribution. This font retains
its upstream terms; it is not covered by the component licenses above.
See [font provenance and attribution](assets/fonts/README.md).

## License texts

- [`LICENSES/GPL-3.0-or-later.txt`](LICENSES/GPL-3.0-or-later.txt)
- [`LICENSES/LGPL-3.0-or-later.txt`](LICENSES/LGPL-3.0-or-later.txt)
- [`LICENSES/MIT.txt`](LICENSES/MIT.txt)
- [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt)

Third-party dependency licenses and copyright notices are reproduced in
release artifacts and mapped to their packages by name and version.
