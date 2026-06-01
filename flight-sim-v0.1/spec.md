This is a really strong base already — you’ve accidentally hit one of the hardest parts: **infinite terrain + local-space flight**. Now we turn this into a *real project* instead of “just code”.

What you need next is **structure + vision**, otherwise you’ll keep adding random features and performance will collapse.

---

# 🧠 Core Design Direction (lock this first)

Your goal (rewritten cleanly):

> A browser-based flight sim that *feels real* through physics, scale, and immersion — not strict realism — set in an infinite procedural world, with eventual combat + AI.

That means every feature should answer:

* Does it improve **feel**?
* Does it improve **scale/immersion**?
* Does it improve **performance**?

---

# 📄 `spec.md` — FULL FEATURE ROADMAP

You can literally copy this into a file called `spec.md`:

---

## ✈️ FLIGHT SIM — MASTER SPEC

### 🎯 Vision

A high-performance, browser-based procedural flight simulator with realistic-feeling physics, massive render distance, and immersive systems, eventually expanding into combat and multiplayer.

---

# 🧱 1. CORE SYSTEMS (FOUNDATION)

## 1.1 Flight Physics (HIGH PRIORITY)

* [ ] Lift system (based on velocity + angle of attack)
* [ ] Drag (quadratic resistance)
* [ ] Gravity always applied
* [ ] Throttle system (0 → 100%)
* [ ] Stall mechanics (loss of lift at low speed / high pitch)
* [ ] Air resistance scaling with altitude

**Goal:** Move from “arcade movement” → “feels like a plane”

---

## 1.2 Camera System

* [ ] Smooth follow camera (lag + interpolation)
* [ ] Adjustable FOV based on speed
* [ ] Cockpit view (later)
* [ ] Free-look mode (mouse independent of plane)

---

## 1.3 Controls

* [ ] Mouse flight control (pitch/yaw)
* [ ] Keyboard backup controls
* [ ] Sensitivity settings
* [ ] Auto-level toggle (optional assist)

---

# 🌍 2. WORLD SYSTEM (MAJOR)

## 2.1 Terrain Generation

* [ ] Biomes (desert, mountains, ocean, plains)
* [ ] Rivers / coastlines
* [ ] Smoother LOD transitions
* [ ] Better noise blending (less blocky terrain)

---

## 2.2 Rendering & Performance (CRITICAL)

* [ ] Chunk pooling (reuse meshes instead of deleting)
* [ ] Instancing for terrain
* [ ] GPU-based terrain (future)
* [ ] Dynamic LOD blending (no popping)
* [ ] Frustum + distance + occlusion culling
* [ ] Increase render distance massively

**Target:** “Horizon feels infinite”

---

## 2.3 Atmosphere

* [ ] Sky gradient (based on altitude)
* [ ] Sun movement (day/night cycle)
* [ ] Fog layers (distance realism)
* [ ] Clouds (procedural or volumetric)

---

# 🛩️ 3. AIRCRAFT SYSTEM

## 3.1 Plane Model

* [ ] Replace cube with basic model
* [ ] Add wings visually tied to lift
* [ ] Engine visual feedback (thrust)

---

## 3.2 Flight Feedback

* [ ] Speed indicator (HUD)
* [ ] Altitude indicator
* [ ] Artificial horizon
* [ ] G-force effects (screen shake, blur)

---

## 3.3 Damage System (future)

* [ ] Crash detection
* [ ] Structural damage
* [ ] Wing loss → spin/crash

---

# 🎮 4. GAMEPLAY LAYER

## 4.1 Exploration

* [ ] Points of interest (cities, airfields)
* [ ] Landing mechanics
* [ ] Fuel system

---

## 4.2 Combat (MID-LATE)

* [ ] Guns (raycast or projectile)
* [ ] Missiles (tracking system)
* [ ] Lock-on mechanics
* [ ] Hit detection

---

## 4.3 AI

* [ ] Basic enemy planes
* [ ] Pathfinding / patrol
* [ ] Dogfight behaviour

---

# 🌐 5. MULTIPLAYER (LATE GAME)

* [ ] Position sync
* [ ] Interpolation smoothing
* [ ] Basic matchmaking / rooms

---

# ⚡ 6. OPTIMISATION SYSTEMS (CRITICAL)

## Must-have

* [ ] Object pooling
* [ ] Geometry reuse
* [ ] Reduce draw calls
* [ ] Chunk streaming prioritisation
* [ ] Async terrain generation (Web Workers)

## Advanced

* [ ] GPU terrain (shaders)
* [ ] Level streaming prioritisation based on velocity
* [ ] Predictive chunk loading

---

# 🎨 7. IMMERSION

* [ ] Engine sound (pitch = speed)
* [ ] Wind noise
* [ ] Camera shake at high speed
* [ ] Lighting changes with altitude
* [ ] Heat haze / motion blur

---

# 🧪 8. DEBUG / DEV TOOLS

* [ ] Toggle LOD visualization
* [ ] Physics debug overlay
* [ ] Chunk load heatmap
* [ ] Performance profiler

---

# 🚀 DEVELOPMENT PHASES

## Phase 1 — Foundation

* Physics overhaul
* Camera improvements
* Basic optimisation

## Phase 2 — World

* Biomes + better terrain
* Atmosphere system

## Phase 3 — Feel

* UI + feedback
* Sound + immersion

## Phase 4 — Gameplay

* Combat + AI

## Phase 5 — Scale

* Multiplayer + massive optimisation

---

# 🧠 What You Should Do NEXT (very important)

Don’t jump everywhere. Your next **3 smartest moves**:

### 1. Replace fake movement with real physics

Right now:

> you rotate + move forward = arcade

You need:

* velocity vector
* forces (lift, drag, thrust)

---

### 2. Fix camera (huge impact on “feel”)

Your current camera is:

> glued to plane → feels stiff

Add:

* smoothing (lerp)
* slight delay
* FOV scaling with speed

---

### 3. Stop deleting chunks

This is killing performance:

```js
scene.remove(chunk);
chunk.geometry.dispose();
chunks.delete(key);
```

Replace with:

* **pooling system** (reuse chunks instead)

---