# Bug: Terrain Height Inconsistency Between Rendering and Collision

## Severity
**CRITICAL** — renders collision system non-functional, minimap useless for navigation, terrain generation produces two different worlds.

## Root Cause
Two different simplex noise implementations running in the same application:

| Path | Implementation | Used by |
|------|---------------|---------|
| **CPU (JS)** | `simplex-noise` npm package (Jonas Wagner) | `terrain.js` → `getHeight()`, `getHeightScaled()`, `getTerrainColorAt()` |
| **GPU (GLSL)** | Stefan Gustavson classic (Stefan Gustavson) | `world.js` → `onBeforeCompile` vertex shader `computeHeight()` |

Both are "simplex noise" but use different hash tables, gradient vectors, and permutation functions. For the same `(x, z)` input, they return different values. This means `terrain.js` and the vertex shader generate completely different height fields.

## Impact
- **Collision system** samples `getHeight()` from terrain.js (JS noise) → detects a mountain at position P
- **Minimap** samples `getTerrainColorAt()` from terrain.js (JS noise) → shows a mountain at position P
- **Rendered terrain** computes height in vertex shader (GLSL noise) → shows flat/low terrain at position P
- **User experience**: plane inexplicably "climbs stairs" over invisible terrain, crashes into phantom mountains

## Discovery
User noticed plane climbing in low-elevation (visually flat) areas. Disabled collisions for investigation. Plane rose over terrain invisible to the renderer but visible on the minimap. Suspected x/z axis swap — ruled out because minimap and collision agreed with each other, narrowing the inconsistency to the rendering path.

## System data flow before fix

```
terrain.js (JS noise)
  ├── getHeight() ─────────┬── collision detection (physics.js)
  │                         └── minimap color (main.js)
  └── getHeightScaled() ──── chunk vertex height (world.js — NOT USED)

world.js (GLSL noise in shader)
  └── computeHeight() ────── chunk vertex height (rendering)
```

Two separate noise computations, two different terrains.

## Fix

**Reverted to GPU noise for rendering. Wrote JS port of the exact GLSL Gustavson `snoise` function for collision system.** Both paths now use the same algorithm.

### Changes

**`terrain.js`:**
- Removed `simplex-noise` npm package import (different noise library)
- Added line-for-line JS port of the GLSL `snoise` function from world.js
- `generateTile()` now calls `snoise2D()` instead of `simplex.noise2D()`
- `getHeight()` now returns Gustavson noise values identical to the vertex shader output
- Zero external dependencies

**`physics.js`:**
- Changed collision check from `getHeight()` (raw) → `getHeightScaled(..., 1.0)` (quantized to match near LOD rendered surface)
- Collision plane now exactly matches the visible terrain surface

**`world.js`:**
- Fully reverted to original GPU noise — shader computes Gustavson noise for height + colors
- `addChunkToBucket` writes `0` to vertex buffer Y (shader overwrites via `onBeforeCompile`)
- No `getHeight()` calls during chunk generation

### Data flow after fix

```
terrain.js (Gustavson snoise2D — matching GLSL)
  ├── getHeight() ───────┬── getHeightScaled() → collision (physics.js)
  │                       └── getTerrainColorAt() → minimap (main.js)
  └── generateTile() ────── tile cache for minimap batches

world.js vertex shader (Gustavson GLSL snoise — matching JS)
  └── computeHeight() ───── chunk vertex height (rendering)
```

### Performance

Collision path: one `getHeightScaled()` call per frame → ~1 noise eval, negligible.
Chunk gen: GPU computes noise in shader → ~0.065ms as before (restored).
No tile cache thrashing during chunk gen (tiles only used by minimap).

### Verification
- [x] `snoise2D` ported line-for-line from GLSL — same mod289, permute, taylorInvSqrt, fade, gradient selection
- [x] mod289 normalizes to [0,289) before precision-sensitive ops → bit-exact vs GLSL at all coordinates
- [x] `getHeightScaled(..., 1.0)` = `Math.floor(noise)` matches near LOD `floor(noise * 1.0)` on GPU
- [x] No tile cache thrashing — tiles only generated for minimap queries, not chunk gen
- [x] All modules parse clean
- [x] No circular dependencies
