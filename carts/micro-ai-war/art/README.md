# Title artwork

`title-painted-source.png` was generated with OpenAI's built-in image tool for
this cart, then reduced deterministically to `title-320.png` by
`../build_title_asset.py`. `../title_asset.ts` is the corresponding Sunny
8bpp source module produced by `tools/png2src.py`.

The generation prompt was:

> A dramatic hand-painted 1990s fantasy computer-game box-art scene for a
> 4:3, 320×240 retro strategy title screen: two compact medieval armies
> converging across a windswept green battlefield; teal-and-silver versus
> crimson-and-brass standards; foreground infantry shield-bearer, archer, and
> mounted lancer; opposing army across the field; gouache and airbrush
> texture, bronze sunset rim light, ominous clouds, melodramatic cartridge-cover
> energy, high-contrast shapes that survive palette reduction. Reserve dark
> upper and lower areas for code-rendered title and start prompt. No text,
> logos, UI, borders, watermark, or photorealism.

From the Calyx repository root, regenerate the checked-in reduced image and
AssemblyScript module from the preserved source:

```sh
npm --prefix carts/micro-ai-war run assets
```

Asset regeneration requires Pillow. The normal cart build consumes the
checked-in generated module and does not require Pillow.
