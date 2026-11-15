# guildloom JRPG icon resources v1

The pack contains 96 JRPG pixel icons for guilds, quests, actions, accounts, ranks and navigation. Each icon is drawn by script on a 32×32 pixel grid using the shared palette. Outlines, lettering and highlights are placed at native resolution. The 64px files enlarge each source pixel to a 2×2 block.

## Files

- `32/<id>.png`: transparent 32×32 source icons. Artwork fits within the central 24×24 area, with at least 4 transparent pixels on each side.
- `64/<id>.png`: exact nearest-neighbor 2× copies.
- `sprite.png`: 512×192 atlas, 16 columns × 6 rows of 32px cells.
- `sprite@2x.png`: 1024×384 atlas.
- `manifest.json`: IDs, Korean labels, relative file paths, coordinates, categories, stage/rank/status mappings, and aliases for UI actions.
- `icons.css`: CSS sprite classes.
- `preview.html`: searchable catalog with 32/64px display, light/dark comparison and individual downloads. Works as a static local file or at `/assets/icons/jrpg-v1/preview.html` when the app is served from the origin root.
- `catalog.png`: labeled visual overview.

## Individual images

```tsx
<img
  src="/assets/icons/jrpg-v1/32/quest.png"
  srcSet="/assets/icons/jrpg-v1/64/quest.png 2x"
  width={32}
  height={32}
  style={{ imageRendering: 'pixelated' }}
  alt=""
  aria-hidden="true"
/>
```

For an icon-only button, give the button an accessible label. Keep existing text labels for rank, status and destructive actions; color and imagery alone should not carry their meaning. F/E/D/C/B/A/S and the unrated dash are baked into the rank assets.

## CSS sprites

```html
<link rel="stylesheet" href="/assets/icons/jrpg-v1/icons.css">
<span class="gl-icon gl-icon--quest" aria-hidden="true"></span>
<span class="gl-icon gl-icon--familiar gl-icon--2x" aria-hidden="true"></span>
```

The base size is 32px, and `.gl-icon--2x` uses 64px. Prefer integer multiples of the source pixel size; fractional scaling softens or distorts the pixel grid. Do not apply smoothing or whole-icon tint filters.

## Manifest

Paths in `icons` are relative to `baseUrl`. With a custom Vite deployment base, prepend `import.meta.env.BASE_URL` to `assets/icons/jrpg-v1/` instead of hard-coding an origin-root path. Rank fallback is `rank-none`; aliases resolve to canonical icon IDs and are not additional PNG files. An alias uses the canonical CSS class, e.g. `cancel` resolves to `gl-icon--close`.

The resources cover the current M1 screens plus the party, rumor, messenger, attachment and familiar features in the project specification. Their presence does not imply those application features are implemented. The app’s Icon component loads individual PNGs by ID.
