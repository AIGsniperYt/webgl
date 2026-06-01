# Terrain Generation System

## Overview

The terrain is generated entirely from GPU-computed simplex noise (GLSL) with an identical CPU fallback (JavaScript) for collision detection and the minimap. There are no heightmaps, no textures, no pre-baked data — every vertex computes its height on the fly using a layered noise stack.

Both paths use the same Gustavson `snoise2D` implementation ported to GLSL and JS respectively. The noise function is deterministic (same input → same output), so the CPU and GPU always agree on terrain height at any world coordinate.

---

## Noise Octaves

Height is the sum of 10+ layered noise samples plus biome-specific modifiers:

```
preDetailHeight = heightProfile + base + hill + mountain
biomeHeight = desertDunes + tundraRuggedness   // gated by biome field
height = preDetailHeight + (detail * elevationFactor) + biomeHeight
```

### 1. Height Profile — Terrace/Plateau Elevation System

The terrain skeleton is a staircase function applied to a broad noise field, creating distinct elevation tiers separated by narrow cliff bands.

```
pf = snoise(wx * 0.0003, wz * 0.0003)   // shaping field, range [-1, 1]
profile = staircase(pf)                   // mapped to 0/80/200/400/600m tiers
```

Where `staircase` is:

```
t = smoothstep(-0.7, -0.4, pf);  profile = mix(0, 80, t)    // 0m → 80m plateau  (gentle, width 0.3)
t = smoothstep(-0.1, 0.1, pf);   profile = mix(80, 200, t)  // 80m → 200m plateau (moderate, width 0.2)
t = smoothstep(0.35, 0.5, pf);   profile = mix(200, 400, t) // 200m → 400m plateau (soft, width 0.15)
t = smoothstep(0.64, 0.71, pf);  profile = mix(400, 600, t) // 400m → 600m platform (dramatic, width 0.07)
```

- Period: ~20944 world units (one full noise cycle of the shaping field)
- Range: 0m to 600m (five discrete tiers)
- Purpose: Creates broad plateaus at 0, 80, 200, 400, and 600m with transitions between them.
- Transition widths decrease **exponentially** with height: 0.3 → 0.2 → 0.15 → 0.07. This matches real mountain formation — lower slopes weather into gentle hills, while only the highest tier retains the raw sharpness of tectonic uplift. A sharp cliff in the middle of a grassland looks unnatural, so those lower transitions are kept gradual.
- Transitions use a **logistic sigmoid** (`sigmoidStep`) instead of the standard cubic Hermite `smoothstep`. The sigmoid approaches 0 and 1 asymptotically, so the ground begins its ascent more gradually and settles back into the next plateau more gently. This reduces the "hard band" look where plateau edges visibly start sloping at a clean line. The steepness constant `k = 5/width` produces a gentler curve than smoothstep's midpoint slope of `1.5/width`.
- The 0m lowland tier is deliberately rare (only terrain below −0.7 in noise space, ~7–10% of land area). This creates infrequent basins that can logically hold lakes without requiring a separate water system.

Each plateau is a flat zone where the profile holds constant. The gaps between plateaus are transition slopes of varying steepness.

This octave is sampled at the **raw world position** (not domain-warped).

### 2. Base (scale=0.02, amplitude=±4m)

```
snoise(warpedPos * 0.02) * 4.0
```

- Period: ~314 units
- Range: -4m to +4m
- Purpose: General fine-scale undulation — the "texture" of lowland terrain

### 3. Hill (scale=0.04, amplitude=±2m)

```
snoise(warpedPos * 0.04) * 2.0
```

- Period: ~157 units
- Range: -2m to +2m
- Purpose: Small hills and dips, adds variety on top of the base layer

### 4. Mountain — Squared Base Domes + fBM Detail + Peak Jaggedness

Mountains are built in three structural layers, not a single octave.

#### 4a. Mountain Base Dome (scale=0.0003, amplitude=0–800m)

```
rawMountain = max(0, snoise(warpedPos * 0.0003))
mountainBase = rawMountain² * 800.0 * mountainMask
```

- Period: ~20944 units (extremely broad)
- Range: 0 to +800m
- Purpose: Creates the massive bulk of mountain ranges. The `max(0, ...)` ensures domes only add height (never carve). The squaring (`rawMountain²`) produces a smooth zero-slope transition at the boundary — mountains rise from the plains with zero slope instead of an abrupt step.

This wide, tall base is why mountains now tower over the fighter jet at cruise altitude. The 800m amplitude is aggressive — only appears where the mask allows.

#### 4b. Rocky Detail — fBM (4 octaves)

```
n1 = snoise(warpedPos * 0.001) × 150m   — broad rock forms
n2 = snoise(warpedPos * 0.003) × 50m    — medium rock bumps
n3 = snoise(warpedPos * 0.009) × 15m    — small rock texture
n4 = ridgedNoise(warpedPos * 0.015) × 10m — faint ridge creases
rockyDetail = n1 + n2 + n3 + n4
```

- Purpose: Adds natural rocky texture to the mountain faces. Uses **Fractional Brownian Motion (fBM)** — stacking noise at progressively smaller scales with decreasing amplitude. Creates a chaotic, organic surface that prevents "plastic" smoothness.
- Gated by `smoothstep(10, 200, mountainBase)` — only activates once the mountain dome is tall enough (>10m), ramping up to full strength at 200m+.

#### 4c. Peak Jaggedness (3 ridged octaves)

```
r1 = ridgedNoise(warpedPos * 0.002) × 150m   — broad ridge cuts
r2 = ridgedNoise(warpedPos * 0.006) × 60m    — medium ridge cuts
r3 = ridgedNoise(warpedPos * 0.015) × 15m    — fine alpine texture
peakJaggedness = r1 + r2 + r3
```

- Purpose: Carves sharp, V-shaped alpine ridges and peaks exclusively at the summits of tall mountains.
- Gated by `peakMask = smoothstep(150, 500, mountainBase)` — only activates near the top of mountains 150m+. Below 150m, these ridges are zero.

#### 4d. Assembly

```
mountainDetail = rockyDetail × smoothstep(10, 200, mountainBase) + peakJaggedness × peakMask
mountain = mountainBase + mountainDetail
```

The mountain base provides 80%+ of the volume. Rocky detail fills the surface with natural texture. Peak jaggedness adds extreme alpine sharpness only at the very top, preserving bulky lower slopes.

#### 4e. Mountain Mask (Dual-Field)

Instead of a single continent-based mask, mountains are gated by two multiplied conditions:

```
mountainRegion = snoise(rawPos * 0.0005)
mountainMask = smoothstep(-0.2, 0.3, mountainRegion) × smoothstep(50.0, 200.0, profile)
```

- `mountainRegion` is a continent-scale noise field (period ~12500 units) that determines *where* mountain ranges form. Values above −0.2 start activating the mask, reaching full activation at 0.3 (roughly top 40% of terrain).
- `smoothstep(50.0, 200.0, profile)` ensures mountains only form where the height profile has already raised the base elevation to at least 50m (ramping to full at 200m). This ties mountain placement directly to the elevation tiers — lowlands at 0m never get mountains; 80m plateaus get partial; 200m+ plateaus get full.

This dual mask creates discrete, isolated mountain belts — not a smooth gradient from plains to peaks. Mountains pop up as distinct ranges separated by wide, flat valleys.

### 5. Detail (scale=0.3, amplitude=±1m, elevation-scaled)

```
float preDetailHeight = continent + base + hill + mountain;
float elevationFactor = clamp(preDetailHeight / 120.0, 0.0, 1.0);
detail = snoise(warpedPos * 0.3) * 1.0 * elevationFactor;
```

- Range: -1m to +1m (full amplitude only at highest peaks)
- Purpose: High-frequency crackle that breaks up the smooth plastic look at close range. Scaled by elevation so valley floors are smooth and peaks are jagged.

- Period: ~21 units
- Range: -1m to +1m (full amplitude only at highest peaks)
- Purpose: High-frequency crackle that breaks up the smooth plastic look at close range. Scaled by elevation so valley floors are smooth and peaks are jagged — matching the real-world pattern where erosion textures intensify at higher altitudes.

---

## Domain Warp

Domain warping is the technique of feeding noise-shifted coordinates into the noise function instead of the raw world position. It is the single most important improvement for natural-looking terrain.

### How it works

```
rawWarpX = snoise(wx * 0.002, wz * 0.002)         // range: [-1, 1]
rawWarpZ = snoise(wx * 0.002 + 5.2, wz * 0.002 + 1.3) // different noise seed, same frequency

warpX = rawWarpX * 100.0   // shift up to ±100m
warpZ = rawWarpZ * 100.0   // shift up to ±100m

warpedX = wx + warpX
warpedZ = wz + warpZ

// All subsequent octaves sample at warpedPos instead of (wx, wz)
height = base(warpedPos) + hill(warpedPos) + mountain(warpedPos) + detail(warpedPos)
```

### What it looks like

Without domain warp, every octave's features align with the noise grid axes. Ridges run in straight lines. Valleys are evenly spaced. The terrain looks like stretched perlin noise — an artificial, computer-generated surface.

With domain warp, each point's effective sampling position is smoothly shifted by up to ±100m. This means:

- Ridge lines curve and bend organically
- Valleys meander instead of running straight
- Features flow into each other like real topography shaped by erosion
- The world no longer looks like it was generated by a math equation

The warp itself is smooth (at scale 0.002, period ~3141 units), so adjacent points shift gradually — the terrain doesn't tear or pinch.

### What is not warped

The height profile and moisture fields are sampled at raw world position — no domain warp. The profile uses a broad 0.0003 scale where warping would need ±300m+ magnitudes to have visible effect. Moisture (0.002 scale) is kept stable so climate zones don't shift as the camera moves.

---

## CPU / GPU Synchronisation

Two copies of the noise logic exist:

| File | Language | Function | Role |
|---|---|---|---|
| `src/terrain.js` | JavaScript | `snoise2D`, `generateTile`, `getHeight` | Collision detection, minimap |
| `src/world.js` | GLSL (in `simplexNoiseGLSL` string) | `snoise`, `computeHeight` | Vertex shader (all 5 LODs) |

Both implement the exact same Gustavson simplex noise algorithm and the exact same `computeHeight` / `generateTile` math with the same constants. The JS path tiles and caches heights (64×64 tiles, LRU cache of 4000 tiles, evicts ~500 at a time when full); the GLSL path recomputes per-vertex every frame.

When modifying the noise stack, both files must be updated identically. A mismatch would cause collision detection to disagree with visible terrain — the plane would float above or clip into the ground.

---

## Surface Colouring

Terrain colour is a 2D biome system driven by **elevation**, **moisture**, and **slope**, not just elevation alone.

### How it works (walkthrough)

The biome colour for each fragment is computed in five steps:

1. **Moisture** — In the vertex shader, every vertex samples `snoise(rawPos × 0.002)` (same Gustavson noise as the height stack, just at its own frequency) and remaps from `[-1, 1]` to `[0, 1]`. This produces continent-scale climate zones with a period of ~3141 units. Sampled at raw world position (no domain warp) so zones are stable and don't wobble as the camera moves.

2. **Slope** — The fragment shader uses `dFdx(vWorldPos) × dFdy(vWorldPos)` to derive the face normal from screen-space derivatives. `n.y` gives the slope (dot with vertical). Converted to degrees, then `smoothstep(30°, 50°)` produces a `rockMix` factor: 0 on flat ground, 1 on cliffs.

3. **Elevation bands** — Three `smoothstep` transitions climb the height profile:
   - `t1`: low→mid at 80–150m
   - `t2`: mid→high at 300–500m
   - `t3`: high→snow at 500–650m

4. **Per-band colour** — Each elevation band computes its own moisture-driven blend:
   - **Low band (0–80m):** `mix(dryGrass, rainforest, moisture)` — dry end is tan-green `#9a9a5a`, wet end is dark green `#2d6b1e`
   - **Mid band (80–300m):** `mix(shrubland, forest, moisture)` — dry end is olive `#7a8032`, wet end is forest green `#3a7d34`
   - **High band (300–500m):** fixed tundra `#8a9a8a` — moisture doesn't matter at this elevation
   - **500m+:** snow `#f0f0f0`

5. **Layer together** — The bands are blended in sequence: `mix(lowCol, midCol, t1)` → `mix(that, highCol, t2)` → `mix(that, snow, t3)` → `mix(that, rock, rockMix)`.

The final colour is: **elevation picks the band, moisture picks where within the band, slope overrides to rock on steep faces**.

### Moisture Field

A continent-scale noise field (scale=0.002, remapped to [0,1]) determines climate zones. Sampled at raw world position — no domain warp — so climate regions are stable and geographically coherent. Period: ~3141 units.

### Biome Matrix

A second large-scale noise field (`biomeField`, scale=0.0001, period ~20000 units) controls which colour palette the low-elevation band uses. A single biome fills most of the visible horizon (5000 units) — you fly into a biome and stay in it, rather than seeing multiple biomes on screen at once. This is separate from the moisture field — biomes shape the ground and its colour, moisture provides fine-grained vegetation variation within each biome.

| Biome field value | Biome | Low-elevation palette |
|---|---|---|
| < −0.2 (dry biome) | Desert/savanna | Sand `#d4b483` → Savanna gold `#b8a84a` (by moisture) |
| −0.1 to 0.1 | Grassland | Dry grass `#9a9a5a` → Rainforest `#2d6b1e` |
| > 0.2 (wet biome) | Rainforest | Shrubland olive `#7a8032` → Rainforest `#2d6b1e` |

The mid band (80–300m) uses a fixed shrubland↔forest blend regardless of biome field. The high band (300m+) is always tundra. This means desert dunes (which only form at low elevation via the terrain modifier) are correctly coloured sandy, while adjacent high ground gets shrubland/forest colours — biomes are elevation-aware.

Blending: The low band uses a **3-way weighted sum** of the three palettes, with `smoothstep` transitions at biome field values −0.4/−0.1 and 0.1/0.4. Within each palette, `mix` provides moisture-driven variation (sand→savanna, dry grass→rainforest, shrubland→rainforest).

**Exception:** The 0m lowland tier (future lake beds) always uses the grassland palette regardless of biome field. A `smoothstep(10, 30, profile)` blend transitions from forced grassland at the very bottom to the biome-driven palette above 30m. This prevents random sand patches in lowland basins.

### Slope Override

World position is passed as a varying from vertex → fragment shader. The fragment shader computes the face normal via `dFdx(vWorldPos) × dFdy(vWorldPos)`. Slopes above 30° blend toward rock colour `#6b6b6b`, reaching full rock at 50°. This prevents "grass on vertical cliff faces" and makes steep terrain look like bare rock.

The CPU/minimap path (`getTerrainColorAt`) uses the same biome-field + moisture + elevation logic but omits slope detection (no height derivatives available without extra noise samples).

### Biome Terrain Modifiers

The biome field also changes the actual terrain shape, not just its colour:

- **Desert dunes** — In low-elevation dry regions (`desertMix`), three octaves of `abs(snoise)` produce asymmetric wind-blown dune shapes: broad swell at 0.003 (±20m), primary dune ridges at 0.006 (±25m), and secondary ripples at 0.012 (±10m). The mountain mask is reduced by 80% in deserts — flat sand seas shouldn't have peaks rising out of them.
- **Tundra ruggedness** — Above 300m elevation, two octaves of extra ridged noise (0.005 × 40m, 0.012 × 15m) carve sharp alpine rock ridges. This makes highland areas feel genuinely mountainous rather than just "snow on the same green terrain."
- **Rainforest extra detail** — Rainforest lowlands keep the current base+hill terrain without modification; the dense vegetation is represented through colour alone.
- **Mid band and above** — Unchanged from the base terrain system; the biome field only modifies terrain shape at low elevation (desert) and high elevation (tundra).

---

## LOD System (5 Levels)

The vertex count is controlled by the chunk step size per LOD, but since Phase 1, all LODs compute height at full floating-point precision (the old `floor(h * lodScale)` quantization is removed).

| LOD | Step (units between vertices) | Vertices per chunk | Render distance (chunks) | Render distance (world units) | Pool capacity | Height range |
|---|---|---|---|---|---|---|---|
| near | 1 | 51×51 = 2601 | 5 | 250 | 250 | -10 to 1000 |
| mid | 5 | 11×11 = 121 | 12 | 600 | 700 | -5 to 800 |
| far | 10 | 6×6 = 36 | 25 | 1250 | 2400 | -2 to 400 |
| ultra | 25 | 3×3 = 9 | 50 | 2500 | 8700 | -1 to 100 |
| horizon | 50 | 2×2 = 4 | 100 | 5000 | 32000 | -1 to 25 |

All LODs feed the same `computeHeight()` function — the only difference is how many vertices per chunk and how far out they extend. This means the horizon LOD's 2×2 vertex chunks sit at the correct mountain heights, giving real silhouettes at the 5000m visibility limit instead of flat planes.

---

## Fog

```
scene.fog = new THREE.FogExp2(0x87ceeb, 0.0004)
```

At 0.0004 density:
- 1000m: 33% fog (near terrain still crisp)
- 2500m: 63% fog (mid-distance begins to haze)
- 5000m: 86% fog (horizon edge mostly concealed)

The fog colour matches the sky (sky blue `#87ceeb`), so distant terrain visually blends into the sky rather than hitting a hard geometric edge.

---

## Parameters Reference

| Constant | Value | Used in | Purpose |
|---|---|---|---|---|
| `CHUNK_SIZE` | 50 | world.js | Size of one chunk in world units |
| `TILE_SIZE` | 50 | terrain.js | Size of one cached heightmap tile |
| `MAX_TILES` | 4000 | terrain.js | LRU cache capacity |
| `heightScale` | 20 | both | Base multiplier for all height contributions |
| `baseScale` | 0.02 | both | Frequency of base undulation |
| `hillScale` | 0.04 | both | Frequency of hill layer |
| `mountainScale` | 0.003 | both | Not currently used in computeHeight |
| `mountainHeightMultiplier` | 4.0 | both | Not currently used in computeHeight |
| `ridgeScale` | 0.001 | both | Present as uniform but unused in computeHeight |
| `continentScale` | 0.0005 | both | Frequency of continent field (mountain mask only) |
| `warpScale` | 0.002 | both | Frequency of domain warp field |
| `profileScale` | 0.0003 (hardcoded) | both | Frequency of height profile shaping field |
| `biomeFieldScale` | 0.0001 (hardcoded) | both | Frequency of large-scale biome region field |
| `moistureScale` | 0.002 | both | Frequency of moisture/climate field |
| `flatnessFactor` | 0.2 | both | How flat the base terrain is |
| `hillHeightMultiplier` | 0.1 | both | How pronounced hills are |
| `mountainBaseScale` | 0.0003 (hardcoded) | both | Frequency of mountain base dome |
| `mountainBaseAmplitude` | 800 (hardcoded) | both | Max height of mountain base dome |
| `mountainRegionScale` | 0.0005 (hardcoded) | both | Frequency of range-placement noise |
| `RENDER_DISTANCE_HORIZON` | 100 | world.js | Furthest chunk ring (5000 units) |
