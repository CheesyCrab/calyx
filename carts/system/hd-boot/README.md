# Calyx HD Boot

The HD boot is a privileged system cart in the Dev and Side B catalogs that marks the switch from
the 320x240 Classic launcher to a fixed 1280x720 cart. Over roughly 1.25
seconds, the already-full-height 4:3 field widens directly from 960x720 to
1280x720, four Calyx petals lock into the added space, and a fast scanning edge
carries the transition through to black before
`sys_launch(0)` hands off to the pending HD target.

Its visual language is intentionally finished without illustrated assets:
flat indexed planes, fine three-pixel petal contours, one-pixel rails and
lights, and hard-edged motion composed at 1280x720. It does not imitate a
detailed scene or imply that an art pass is missing.

The runner instantiates this role with a synthetic catalog containing exactly
the pending HD target. Cart 0.2.0 uses the Calyx ABI v1.6 system surface.
The cart ignores player input. Its framebuffer, custom
16-color palette, tones, trace, and launch event are deterministic and
independently verifiable.

From the Calyx root, build and verify it with:

```sh
npm --prefix carts/system/hd-boot ci
python3 tools/dev.py cart hd-boot
python3 conformance/check.py verify
```

The cart adds no ABI import, selects no arbitrary resolution, accepts no analog
input, and does not enter the release catalog. All geometry, text, palette
values, and tones are authored in `cart.ts`; there are no external or
third-party assets.
