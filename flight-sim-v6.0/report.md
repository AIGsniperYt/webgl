# Terrain Generation — Post-Mortem & Handoff Report

## Current State

We have a 5-octave GPU/CPU-synced terrain generator built entirely from simplex noise (Gustavson `snoise2D`, identical GLSL + JS ports). Height is computed as:

```
continent(0.0005, ±40m)         ← raw world pos, NOT domain-warped
  + base(0.02, ±4m)             ← at warped pos
  + hill(0.04, ±2m)             ← at warped pos
  + mountain(0.003, ridged)     ← at warped+stretched pos, × mountainMask
  + detail(0.3, ±1m)            ← at warped pos, × elevationFactor
```

The mountain octave uses `ridgedNoise = (1-|snoise|)²` for V-shaped valleys and knife-edge ridges, masked by `smoothstep(-15, 25, continent)` so mountains only appear in high-continent regions. Domain warp displaces coordinates ±100m at 0.002 scale for organic curving. All coordinates fed to the engine via the `onBeforeCompile` shader injection system on `MeshStandardMaterial`, shared across all 5 LODs (near→horizon, step 1→50).

## What's Wrong

### Problem 1: The Ridges Look Like Frozen Ripples, Not Mountains

The anisotropic ridge stretching (last change) replaced the coiling-snake ridges with parallel ridge lines that look like sharp ripples on a pond. Within any region, the ridge angle is nearly constant (ridgeScale=0.0003, period ~10,500 units), so the 3.3× compression creates evenly-spaced parallel ridges. Where two angle regions meet, they form grid-like interference patterns.

**Root cause:** This is what ridged noise *always* does with stretching — it creates equally-spaced V-shaped grooves. The stretching turns isotropic blobs into anisotropic stripes, but the underlying problem is the same: ridged noise produces a uniform field of sharp features at a single dominant wavelength.

### Problem 2: Mountains Don't Feel Big or Grand

The maximum terrain height is about 80m (mountainHeightMultiplier=4.0 × heightScale=20.0 + continent + other). A fighter jet at cruise sits at ~200m and the world below is a carpet of sharp wrinkles, not massive landforms. The mountains look like small-scale roughness, not geography.

**Root cause:** Noise-based terrain at any scale produces features proportional to the noise wavelength. A feature at scale 0.003 has period ~2094 units, meaning ridges are spaced ~2000 units apart — but they're only 80m tall, so the aspect ratio is ~25:1 width:height. Real mountains have much steeper aspect ratios and are concentrated into massive bulks, not evenly distributed.

### Problem 3: The Continent Mask Isn't Creating Mountain *Ranges*

The `smoothstep(-15, 25, continent)` mask transitions from 0 to 1 over a 40m elevation band. This creates a gradient of ridged noise amplitude, but it doesn't concentrate mountains into discrete ranges — it just makes them taller in high areas and shorter in low areas. The ridges are still everywhere, just at different amplitudes.

**What we want:** Discrete mountain belts separated by wide flat valleys or plains, not a continuous field of sharp wrinkles with varying amplitude.

## What test.html Does Differently

The single-mountain example in test.html builds mountains in two distinct stages:

**Stage 1 — Smooth base shape:**
```
r = sqrt(x² + z²)
if r > R: return 0
base = h * pow(1 - pow(r/R, p), q)
```
This creates a smooth, broad dome (80m tall, 150m radius) with no noise. It's a single monolithic feature, not a field.

**Stage 2 — Rugged detail on top:**
```
detail = (octaveNoise + ridgeNoise) * pow(base/h, s)
return base + detail * 10
```
The noise and ridged noise are scaled by `(base/h)^s` — zero where the base is flat, full amplitude at the peak. The rough detail is *draped onto* the smooth mountain, not used to build the mountain itself.

**Key insight:** The mountain is a SMOOTH MACRO-SHAPE with ROUGH TEXTURE ON TOP. This is the opposite of what we're doing — we're building the mountain entirely from ridged noise, which produces roughness at every scale.

## What We Know Works (From test.html Experiments)

1. **Continent as a mask works** — it successfully constrains mountain amplitude to continental highlands. The last Phase 3 change proved this.
2. **Elevation-scaled detail works** — the detail octave scaled by `clamp(height/60, 0, 1)` is the correct pattern (peaks jagged, valleys smooth).
3. **Domain warp is essential** — without it, terrain looks like stretched Perlin noise. The warp period is well-tuned at 0.002 with ±100m shift.
4. **Independent snoise gradients fixed axis bias** — the Z-direction ridge lines are gone.

## Project Constraints That Cannot Change

- **No THREE.js dependency in terrain.js** — terrain generation must be standalone for collision and minimap
- **CPU and GPU paths must match identically** — collision detection depends on this
- **CHUNK_SIZE stays at 50** — scaling is done via LOD system
- **`onBeforeCompile` injection** is the only way to modify the terrain shader
- **5 LODs (near/mid/far/ultra/horizon)** with step sizes 1/5/10/25/50
- **Performance is a concern** — the vertex shader runs on every visible vertex every frame (~50K-100K vertices for all LODs combined)
- **No textures, no heightmaps** — all terrain is procedurally generated from noise

## What We Can Change (Without Breaking Constraints)

### Approach 1: Replace Ridged Noise With Smooth Domes + Ridged Detail

**Inspiration:** test.html's two-stage construction.

Instead of:
```js
mountain = ridgedNoise(warpedPos * 0.003) * 80 * mountainMask
```

Use:
```js
// Stage 1: Smooth mountain envelope from continent
mountainBase = max(0, snoise(warpedPos * 0.001)) * 200 * mountainMask

// Stage 2: Ridged detail scales with envelope height  
ridgedAmplitude = ridgedNoise(warpedPos * 0.003) * 60
mountain = mountainBase + ridgedAmplitude * (mountainBase / 100)
```

The smooth octave at 0.001 (period ~6283 units) with `max(0, ...)` creates gentle domes and bulges, not knife-edge ridges. The ridged noise adds detail proportional to the smooth envelope height — so peaks are jagged and valleys are smooth.

**Caveat:** The smooth dome octave eats a noise evaluation in the vertex shader (performance concern). The `max(0, snoise)` call adds ~1 ALU operation and a noise evaluation — measurable but likely minor on modern GPUs with 50K-100K vertices.

### Approach 2: Multiple Octaves of Ridged Noise at Different Scales

Ridged noise at a single scale produces ridges at a single dominant wavelength. Real topography has ridges nested within larger ridges. Stack two or three ridged octaves:

```js
ridge1 = ridgedNoise(warpedPos * 0.0015) * 120 * mountainMask  // broad ridges
ridge2 = ridgedNoise(warpedPos * 0.003) * 40 * mountainMask    // medium ridges
ridge3 = ridgedNoise(warpedPos * 0.006) * 15 * mountainMask    // fine ridges
mountain = ridge1 + ridge2 + ridge3
```

This creates ridge-on-ridge hierarchy — big mountain masses with smaller ridges cut into them, which looks much more natural.

**Caveat:** Each octave is another noise evaluation. Three ridged octaves = 3× the ALU cost for the mountain component. May need to reduce detail octave or base octave to compensate.

### Approach 3: Change the Continent-to-Mountain Mapping

Instead of `smoothstep(-15, 25, continent)` which creates a linear gradient, use a sharper threshold to concentrate mountains into discrete belts:

```js
mountainMask = smoothstep(5, 15, continent) 
  - smoothstep(25, 35, continent) * 0.5  // central band peak, edges taper
```

Or encode a second noise octave for the mountain *location*:

```js
mountainRegion = snoise(pos * 0.0008)  // second continent-scale field
mountainMask = smoothstep(0, 0.5, mountainRegion) * smoothstep(-15, 25, continent)
```

This way, not every high-continent area gets mountains — they only appear where both the continent elevation AND a secondary field align, producing discrete ranges.

### Approach 4: Amplitude Scaling

Simply increase `mountainHeightMultiplier` from 4.0 to 8.0 or 16.0. The simulation physics already handles altitudes up to 8000m (the `heightScale * 3.0` clamp in elevationFactor). The engine was designed for 80m max terrain — need to check fog density, camera initial position, and crash altitude tolerances if mountains go to 200-400m.

**Potential issues:** LOD height ranges (`LOD_HEIGHT_RANGES` in world.js) set per-LOD bounding boxes. Near goes to 90m max. If terrain exceeds 90m, near-LOD frustum culling will clip chunk tops. Would need to update to `{ min: -10, max: 400 }` for near and scale down for lower LODs.

## Suggested Order of Investigation

1. **First** — Try approach 4 (amplitude scaling) alone. It's a 1-line change and if it looks better at 200m+ peak heights, the problem was just "not tall enough." If the terrain still looks like a carpet of wrinkles, the problem is structural, not magnitude.

2. **If amplitude scaling fails** — Implement approach 1 (smooth domes + ridged detail). This requires adding a new octave to both GLSL and JS, modifying `computeHeight` / `generateTile`, and verifying CPU/GPU sync. The test.html precedent strongly suggests this is the right direction.

3. **If domes create the right shape** — Use approach 2 (multiple ridged octaves) to add nested ridge detail at smaller scales, breaking up the single-wavelength look.

4. **Tune continent-mask mapping** (approach 3) last — it's a refinement on top of the terrain shape, not a shape fix itself.

## Files to Modify

| File | Purpose |
|---|---|
| `src/world.js:49-73` | `computeHeight` GLSL function — the mountain octave and any new octaves |
| `src/world.js:219-229` | Uniform declarations in `onBeforeCompile` |
| `src/world.js:250` | `computeHeight` call in `begin_vertex` injection |
| `src/terrain.js:94-128` | `generateTile` — must match `computeHeight` exactly |
| `src/terrain.js:4-13` | Constants — add new scale/amplitude constants |
| `src/changelog.md` | Document changes |
| `src/terrain.md` | Update noise octave documentation |
| `src/world.js:94-101` | `LOD_HEIGHT_RANGES` — update if max height changes substantially |

## Current Noise Parameter Constants

| Constant | Value | Octave |
|---|---|---|
| `heightScale` | 20 | Base multiplier for all |
| `baseScale` | 0.02 | Base undulation |
| `hillScale` | 0.04 | Small hills |
| `mountainScale` | 0.003 | Ridged noise frequency |
| `continentScale` | 0.0005 | Continent basin frequency |
| `warpScale` | 0.002 | Domain warp frequency |
| `ridgeScale` | 0.0003 | Ridge angle field frequency |
| `flatnessFactor` | 0.2 | Base amplitude factor |
| `hillHeightMultiplier` | 0.1 | Hill amplitude factor |
| `mountainHeightMultiplier` | 4.0 | Mountain amplitude factor |
| `snowLevel` | 39.6 | Not used in compute (only in color helpers) |

The `heightScale * 3.0` in the elevationFactor clamp gives a "full-detail threshold" of 60m. If mountains grow taller, this should scale proportionally (e.g., `heightScale * 10.0` for 200m peaks).

## An Important Detail: The Warp Order

Currently the mountain octave applies the ridge-angle rotation and stretch **after** domain warping:
```js
ridgeAngle = snoise(rawPos * ridgeScale) * π
// rotate warpPos (which is already warped by ±100m)
stretchPos = rotate(warpPos, ridgeAngle) * (0.3, 1.0)
mountain = ridgedNoise(stretchPos * mountainScale) * ...
```

The ridge angle field is sampled at RAW position (not warped, not stretched). This seems correct — the tectonic stress direction shouldn't be distorted by the local erosion warp. But it means the ridge angle is very slowly varying (0.0003) and the domain warp (±100m) barely affects it, which is intentional.

However, the ridgeAngle itself might be part of the ripple problem — at 0.0003, the direction field changes so slowly that within any visible region, all ridges are nearly parallel. A more dynamic angle field (e.g., two octaves of warp noise driving the angle) might help.

## Final Notes

The `ridgedNoise` at single-scale produces an intrinsically uniform field of sharp V-shaped features — it's literally the same shape repeated at different scales. Real mountains have a hierarchical structure: broad domes, then ridges cut into them, then smaller ridges cut into those. This is fractal-like and noise is actually well-suited to it — we just need multiple ridged octaves at different scales, combined with a smooth base shape.

The test.html approach (smooth dome + scaled ridged detail) is the most promising path. It produced a convincing single mountain with 30 lines of code. The challenge is scaling that to infinite terrain — the "smooth dome" for infinite terrain is the continent octave plus a smooth mountain envelope, not a radial distance function.
