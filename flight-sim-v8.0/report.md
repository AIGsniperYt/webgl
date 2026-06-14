# Performance Analysis — Cruise F-16, Chase Cam, No Input

## What Started This Investigation

After removing the minimap and applying physics fixes (alignmentRate 4.0→2.5, postStallFadeAngle 45°→15°), the profiler showed **avgFPS had collapsed from 77.9 to 25.9**. This seemed catastrophic. However, **playtester feedback was the opposite** — friends reported the game felt *smoother* after the minimap removal, with less stutter. The contradiction between profiler numbers and real-world feel raised the question: **is the profiler producing inflated/wrong numbers, or is there a real regression?**

The goal: understand what's actually happening, and if real, bring the numbers back down.

---

## Side-by-Side: Old (Horizon LOD) vs Current (Physics Fix + alignmentRate 2.5)

Both runs: F-16, chase cam, no user input, fresh page load, 40,803 total chunks, 5 LODs, same chunk code.

| Metric | **Old (Horizon LOD)** | **Current (alignmentRate=2.5)** | **Delta** |
|---|---|---|---|
| **avgFPS** | **77.9** | **25.1** | **↓ 68%** |
| avgGen(ms)/sample | 176.95 | 546.67 | ↑ 3.1× |
| avgPhys(ms)/sample | 3.79 | 203.77 | **↑ 54×** |
| gen/frame | 2.95ms | 9.11ms | ↑ 3.1× |
| **phys/frame** | **0.063ms** | **3.40ms** | **↑ 54×** |
| +chunks/sample (cumulative) | 56,546 | 145,981 | ↑ 2.6× |
| avg +chunks per crossing | ~577 | ~577 | same |
| Chunk crossings/sample | ~98 | ~253 | ↑ 2.6× |
| equivalent ground speed | ~200-300 m/s | **210→445 m/s** | ↑ ~1.8× |
| endVisible | 10,252 | 10,640 | ±4% |
| endMem(MB) | 103.2 | 76.2 | same |
| totalTilesGen | 2,538 | 259 | ↓ 10× |
| **Profile duration** | **~11.5s** (900 frames / 78fps) | **~40s** (900 frames / 25fps) | ↑ 3.5× |

---

## Issue #1: Profile Duration Grew from 11s to 40s

The profiler records `maxFrames = 900` frames before auto-stopping. At 78fps, that's 900/78 ≈ 11.5 seconds. At 25fps, that's 900/25 = 36 seconds (plus startup overhead → observed ~40s).

**The longer profile is a CONSEQUENCE of lower FPS, not a cause.** The profiler doesn't run longer by design — it just takes more wall-clock time to capture 900 frames at a lower frame rate.

---

## Issue #2: Profiler May Be Flawed or Inflated

Playtesters report the game feels *smoother* after the minimap removal, directly contradicting the profiler's 78→25 FPS reading. Possible explanations:

### Theory A: profiler accumulates incorrectly

The profiler (`main.js:964-990`) accumulates `s.chunkGenTime` over 60 frames. But `getChunkStats()` resets `_chunksAdded`/`_chunkGenTime` to 0 every frame. **If the profiler reads `_chunksAdded` after stats are reset by some other code path, the numbers would be zero. They aren't**, so this path seems clean.

### Theory B: the old 77.9fps benchmark was invalid

The old Horizon LOD data was collected in a separate session. Conditions may have differed:
- **Throttle:** If the plane wasn't at full throttle in the old run, it would fly slower, cross fewer chunks, and leave more GPU headroom
- **Flight path:** Maybe the old run had slight turns reducing net camera translation
- **System load:** Background processes, thermal throttling, browser tabs

### Theory C: physics time measurement is double-counting

Old phys: 3.79ms/sample (0.063ms/frame). Current phys: 203.77ms/sample (3.40ms/frame). **54× increase with only two scalar values changed** — this is suspicious. If the old measurement was wrong (e.g., `_physicsTime` was not being set correctly in earlier code), the comparison is invalid.

### Theory D: the `getChunkStats()` and `getPhysicsStats()` calls add overhead

Both are called every frame during profiling (lines 966-972). If these functions themselves are expensive (e.g., creating objects or doing work), they'd add to the measured times. But they're simple getters:
```js
// getChunkStats() — just reads and resets a few numbers
{ chunkGenTime, chunksAdded, chunksRemoved, ... }
// getPhysicsStats() — just reads _physicsTime
{ physicsTime: _physicsTime }
```

These should add <0.001ms per call.

### What to do about it

The profiler's **absolute** numbers (25fps, 546ms gen, 203ms phys) may be inflated. But the **relative** trends within a single run are reliable:
- gen rises with crossing rate ✓
- phys is flat across samples ✓
- adds double over 40s as plane accelerates ✓

**If the profiler over-reports by a constant factor, the absolute fps may actually be higher than 25.** A quick cross-check: render a known frame in Chrome DevTools' Performance tab and compare frame duration to the profiler's `ftotal` value.

---

## Root Cause #3: Chunk LOD Key System (+577/crossing, not +201)

*This is the dominant structural issue regardless of profiler accuracy.*

Chunk keys are `${x},${z},${lod}` (`world.js:590`). When the camera moves 1 chunk step, every chunk near an LOD ring boundary changes LOD → gets a new key → is **removed and re-added** even though it never left the loaded area.

**Per chunk crossing (+X direction):**

| Source | Adds | Why |
|---|---|---|
| Leading-edge new chunks entering render radius | 201 | Horizon LOD |
| Inward LOD migration (far→mid, mid→near, etc.) | 188 | Chunks nearer center get higher LOD |
| Outward LOD migration (near→mid, mid→far, etc.) | 188 | Chunks farther from center get lower LOD |
| **Total** | **577** | **vs 201 if LOD not in key** |

The 188+188 = 376 LOD re-additions are invisible to the user — same (x,z), same geometry, just a different LOD label. But each counts toward `_chunksAdded`, triggering `addChunkToBucket()` with full geometry init.

**Fix option:** Store LOD as a mutable property on the chunk, not embedded in the key. Only add/remove when the (x,z) position enters/leaves the render radius. Would cut ~65% of chunk-gen operations.

---

## Root Cause #4: F-16 Full-Throttle Acceleration (210→445 m/s)

The F-16 at 100% throttle with 129 kN thrust accelerates from 210 m/s to ~445 m/s over 40 seconds. This naturally doubles the chunk crossing rate.

| Sample | Elapsed | Observed adds/s | Predicted adds/s (577 × v/50) | Speed |
|---|---|---|---|---|
| S0 | ~1s | 2,597 | 2,433 | ~225 m/s |
| S5 | ~13s | 3,693 | ~3,380 | ~320 m/s |
| S10 | ~26s | 4,808 | ~4,400 | ~416 m/s |
| S14 | ~35s | 5,117 | ~5,088 | ~443 m/s |

**Match within ~10%** — no oscillation, no drift, no crab. The crossing rate is fully explained by physics-model acceleration and the 577-adds-per-crossing LOD amplification.

The old benchmark's 200-300 m/s cruise would produce proportionally fewer crossings and lower gen time.

---

## Root Cause #5: Physics Time 54× Higher (0.063ms → 3.40ms) — **UNEXPLAINED**

The physics code is identical between old and current except for two scalar values. The timing mechanism (`_start`/`_physicsTime` at lines 445/660) was **unchanged** in the latest commit. Debug arrows (`updateDebugVectorArrows()` at line 661) run AFTER the timer and don't contribute.

| Hypothesis | Verdict |
|---|---|
| Arrow geometry recreation adds time | ❌ After timer, not counted |
| `getHeightScaled` is slow | ❌ Single cache lookup per frame |
| Noise computation is slow | ❌ Pure arithmetic, no allocations |
| V8 JIT deopt from new scalar values | ⚠️ Possible — `postStallFadeAngle` changed from 45° to 15°, but only used at stall AoA |
| Old phys measurement was wrong | ⚠️ Possible — if `_start` was missing in old code, 0.063ms was never real |

**Even if we trust the current 3.40ms/figure, physics is only 9% of frame budget at 27fps.** The gen-time bottleneck is 3× larger.

---

## Summary

| Issue | Real? | Impact | Fix |
|---|---|---|---|
| LOD key causes 577 adds/crossing (not 201) | **Yes** | 2.87× unnecessary gen ops | ✅ Store LOD as mutable property, not in key |
| F-16 accelerates 210→445 m/s over 40s | **Yes** | Crossing rate doubles → gen doubles | ✅ F-16 initialThrottle 0.55 for cruise benchmarks |
| 78→25 fps profiler reading | **Possibly inflated** | Playtesters feel improvement | Cross-check with DevTools Performance tab |
| Phys time 54× higher | **Unknown** | 3.4ms/frame (9% of budget) | Add internal timestamps to locate the 3.3ms |
| Profile duration 11s→40s | **Consequence** | Just 900 frames at lower fps | — (fixes automatically when fps recovers) |

**Next step:** ~~The simplest actionable fix is **#1 (LOD key → mutable property)**.~~ **Done (06/06/2026).** Re-profile with F8 to measure impact. Remaining open items: cross-check profiler with DevTools Performance tab; add physics sub-timestamps if phys time stays elevated.
