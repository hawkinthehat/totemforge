# Coast Salish Formline Carving Canvas

A local-first Progressive Web App built around one full-screen yellow cedar carving surface.

## Experience

- A single horizontal ST'ÉXEM formline composition is centered on a textured cedar block.
- A unified low-opacity charcoal silhouette keeps the uncarved wood present beneath the finished artwork.
- A red cedar snag sweeps calmly across the center on a 10-second horizontal cycle.
- Each successful touch strike uses a generous 45px hit area, hides the snag for 1.5 seconds, and opens the next anatomical formline section.
- Each strike releases 35-45 irregular splinters that fly from the exact touch point into the section being opened while shifting from bark tones to the finished cream and charcoal palette.

## Run locally

```sh
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173/`.

## Verification

```sh
node --check js/engine.js
node --check js/haptics.js
node --check sw.js
```
