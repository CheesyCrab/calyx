# Calyx Marks

This directory owns the product and software development kit (SDK) marks used
by the repository and assembled players.

- `calyx-mark.svg` is the primary Calyx product mark.
- `calyx-sideb-mark.svg` is the red mark for the separately branded test
  channel.
- `sunny-mark.svg` is the Sunny SDK mark.
- `native/` contains the committed ICO and ICNS derivatives plus their source
  digest record.

The vector marks use a transparent background, a `512 x 512` view box, and one
flat fill color.

## Product use

Use `calyx-mark.svg` for the browser player, application icons, About surface,
package instructions, and repository front door. Use `sunny-mark.svg` only on
authoring and SDK surfaces. Do not use either mark as an individual cart logo.

`web/icon.svg` is the distribution copy of the Calyx mark. Product tooling
verifies that copy and derives browser sizes from it. The red mark keeps the
same geometry and identifies its separate application identity; it does not
replace the primary mark.

Generate and verify native application icons from the repository root:

```sh
node tools/gen_native_icons.mjs
```

`native/icon-source.json` records the canonical SVG and output hashes. Commit
the ICO, ICNS, and digest record together after an intentional regeneration.

## Identity

1. **Cheesy Crab** — project credit: “Games · Software · Worlds.”
2. **Cheesy Crab Calyx** — formal product name.
3. **Calyx** — ordinary prose and user-interface shorthand.
4. **CAL/X** — in-world display mark.
5. **Sunny** — Calyx cart SDK.

Use a text credit such as “A Cheesy Crab project” where a project credit is
needed. This repository does not define a separate Cheesy Crab graphic.

Default colors:

- Calyx gold: `#d6a62a`
- test-channel red: `#b13e53`
- Sunny yellow: `#f7c843`
- recommended dark ground: `#1a1c2c`

Keep the four-petal geometry and center circle intact. Do not add gradients,
shadows, or interface decoration to the canonical SVGs.
