# m6x11 font

The pinned bitmap in `m6x11-v1.json` is derived from **m6x11 by Daniel Linssen**.

Upstream source and terms: <https://managore.itch.io/m6x11>. The creator states
“free to use with attribution” (checked 2026-09-11). Keep the author credit and
source link when redistributing the font or the Calyx runtime that embeds it.

The original TTF is not required to build Calyx. The JSON is the canonical
bitmap source for generated native, web, and Sunny font data. Do not rerasterize
it casually: glyph bytes are part of the deterministic drawing contract.

The JSON retains its historical `source` path to preserve the ABI-pinned file
digest. That path describes the original import; it is not a build dependency.
