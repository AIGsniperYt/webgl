# Devlog Tracker

## Progress

- Theme per row
- **Covered** = footage/analysis already captured for a devlog episode
- **Planned** = queued for a future devlog
- Notes column for episode ideas, timestamps, or references

## Foundation & Refactor

| Date | Commit | Message | Covered | Notes |
|---|---|---|---|---|
| 2025-09-16 | `408815d` | Update README.md | ✅ | Trivial setup — covered (no devlog needed) |
| 2025-09-16 | `477f115` | Add files via upload | ✅ | Trivial setup — covered (no devlog needed) |
| 2026-05-21 | `133f4fd` | Import existing flight sim project into submodule | ✅ | Trivial setup — covered (no devlog needed) |
| 2026-05-21 | `d24af20` | refactor into es6 modules | ❌ | First real cleanup — split main.js into modules |
| 2026-05-22 | `fe06717` | further minor tweaks | ❌ | |
| 2026-05-22 | `8da2587` | MAJOR physics improvement | ❌ | |

## Optimisation Wave

| Date | Commit | Message | Covered | Notes |
|---|---|---|---|---|
| 2026-05-23 | `6520b8b` | batch 1 of MASSIVE OPTIMISATION improvements on terrain generation and rendering | ❌ | |
| 2026-05-23 | `a62540a` | merged geometries per LOD reducing draw calls - mini update checkpoint | ❌ | |
| 2026-05-24 | `fdfdac2` | feat: Implement GPU terrain rendering with predictive loading and processing metrics | ❌ | |
| 2026-05-24 | `c2ba033` | MAJOR: optimisations update complete, very fast now | ❌ | |

## Physics & Collisions

| Date | Commit | Message | Covered | Notes |
|---|---|---|---|---|
| 2026-05-24 | `3d9f76d` | simple collision detection and response for a 2D physics engine | ❌ | |
| 2026-05-24 | `b49b2e4` | bug fix #1 - no noise computation in gpu - bad optimisation, but atleast collisions work | ❌ | |
| 2026-05-24 | `1e29cb7` | MAJOR: made collisions work and fixed the critical divergence bug between cpu and gpu noise terrain gen, and optimised again | ❌ | |

## Cache & Frustum Culling

| Date | Commit | Message | Covered | Notes |
|---|---|---|---|---|
| 2026-05-24 | `8dc9937` | minor update to optimise cache | ❌ | |
| 2026-05-25 | `91adbf6` | index on (no branch): 8dc9937 minor update to optimise cache | ❌ | Stash entry |
| 2026-05-25 | `5443750` | WIP on (no branch): 8dc9937 minor update to optimise cache | ❌ | Stash entry |
| 2026-05-25 | `e31c098` | frustum culling attempt 2# (suboptimal) - temporary commit | ❌ | |
| 2026-05-25 | `7c8b565` | attempted frustum cull limitation fix 1# use margins - failed because fundamentally it isnt a fix, only a patch, a fast turn outpaces this | ❌ | |
| 2026-05-26 | `3dec4da` | attempted increase render distance, but it caused bugs because quadrant culling is a flawed concept | ❌ | |

## Rendering & Crash Logic

| Date | Commit | Message | Covered | Notes |
|---|---|---|---|---|
| 2026-05-26 | `4705a07` | horizon LOD at step=50 doubles render distance to 5000wu, fog tuned to 0.0004, profiler fixed for correct avg fps, and respawn slot exhaustion fixed | ❌ | |
| 2026-05-26 | `e02a12f` | stall visual indicator | ❌ | |
| 2026-05-26 | `f2d4ba7` | update #1 on crash logic - angle of impact only | ❌ | |
| 2026-05-26 | `aaac521` | update #2 on crash logic - track vertical velocity to disallow fast descents | ❌ | |
| 2026-05-26 | `e566e9f` | update #3 for crash logic - overspeed | ❌ | |

## Terrain & Biomes Saga

| Date | Commit | Message | Covered | Notes |
|---|---|---|---|---|
| 2026-05-26 | `f0be98d` | phase 1 of radical terrain gen update | ❌ | |
| 2026-05-26 | `94e77eb` | phase 2 of radical terrain updates | ❌ | |
| 2026-05-26 | `2827250` | improved regional terrain generation for clusters of mountains and plains | ❌ | |
| 2026-05-26 | `2ef1a56` | fixed ridge line artifacts | ❌ | |
| 2026-05-26 | `d6b7bfe` | attempted improvement to add dominant ridge directions to mountains - not perfect | ❌ | |
| 2026-05-27 | `e98c46e` | added improved proper terrain gen, and a minor update implementing gforce blackout (lag has begun) | ❌ | |
| 2026-05-28 | `9215a5c` | minor update to disable g forces vfx since it wasnt functional | ❌ | |
| 2026-05-28 | `68aa62d` | biomes attempt 1# | ❌ | |
| 2026-05-28 | `5f27887` | terrain update #2 (from biome #1) | ❌ | |
| 2026-05-28 | `175a7f7` | terrain attempt #2 | ❌ | |
| 2026-05-28 | `43b82f7` | terrain #3 - exponential slode width with altitude bands | ❌ | |
| 2026-05-28 | `04fa1d5` | terrain final update adding sigmoid func softening to avoid obvious height profile banded look | ❌ | |
| 2026-05-28 | `75373fc` | biomes #2 - heavy update | ❌ | |
| 2026-05-28 | `dab01ee` | added lakes and water | ❌ | |

---

## Notes

<!-- Freeform space for per-commit notes, e.g.:

### `fdfdac2` — GPU Terrain Rendering
- Good footage: flyover showing chunk loading/unloading
- Talk about predictive loading algorithm
- Timestamp in raw footage: 12:34

-->
