# Flight Physics Notes

This file explains the variables shown in the in-game debug log and how they map to the flight physics formulas in `src/physics.js`.

The simulator treats the aircraft as a rigid body with a velocity vector. Each frame it calculates aerodynamic forces, adds them together, divides by mass to get acceleration, then integrates velocity and position.

## Coordinate System

- `+X`: world right/east
- `+Y`: world up/altitude
- `+Z`: world backward/south
- Aircraft forward axis: local `-Z`
- Aircraft up axis: local `+Y`
- Aircraft right axis: local `+X`

## Core Ideas Before The Formulas

An aircraft does not simply "move forward and turn." It has forces acting on it every frame. Those forces change acceleration, acceleration changes velocity, and velocity changes position.

The important idea is:

```text
forces -> acceleration -> velocity -> position
```

The plane's nose direction and movement direction are related, but they are not the same thing. The aircraft can point one way while still moving another way. That difference is what creates angle of attack, sideslip, stalls, and most of the interesting flight behavior.

### Velocity Is Not The Same As Facing Direction

The aircraft has a forward axis: where the nose points.

The aircraft also has a velocity vector: where it is actually moving.

If the nose points slightly above the movement direction, the wing sees the air hitting it at an angle. That angle is angle of attack, written as alpha (`alpha`). More alpha usually means more lift, until the wing stalls.

### Lift Depends On Airflow

Lift is not magic upward force. It comes from air moving over the wing.

That means lift depends mostly on:

- how fast you are moving through the air
- how dense the air is
- how much wing area you have
- what angle the wing has to the airflow

This is why climbing is easier with speed. If airspeed gets too low, the wing does not have enough airflow to make enough lift, even if the nose is pointed upward.

### Drag Is The Cost Of Moving Through Air

Drag is the force that resists motion. It points opposite the velocity vector.

There are two very important kinds of drag in this sim:

- parasite drag: baseline body/skin drag
- induced drag: drag caused by making lift

When you pull up hard, `CL` increases. That can increase lift, but it also increases induced drag. Past a point, pulling harder makes you slower and can make the climb worse.

### Banking Turns The Plane

In a bank, lift tilts with the aircraft.

Part of lift still points upward, but part of it points sideways. That sideways part bends the velocity vector and turns the aircraft.

This is why aircraft mostly turn by rolling, not by yawing like a car or boat.

### Stalling

A stall happens when angle of attack gets too high.

In normal flight, increasing AoA increases `CL`. After the stall angle, the wing cannot keep smooth airflow attached, so lift stops increasing and may drop. Drag also gets much higher.

In the debug log, this is where `AoA` gets large, `STALL` appears, and `Thrust / Drag` may fall below `1.0`.

## Core Formulas

### Dynamic Pressure

`q = 0.5 * rho * v^2`

- `q`: dynamic pressure, in pascals (`Pa`)
- `rho`: air density, in kilograms per cubic meter (`kg/m^3`)
- `v`: airspeed, in meters per second (`m/s`)

Dynamic pressure is the "air force available" from speed. Since speed is squared, going twice as fast gives roughly four times the aerodynamic force.

Example:

```text
If speed doubles:
q = 0.5 * rho * (2v)^2
q = 4 * (0.5 * rho * v^2)
```

So a small speed change can create a big lift/drag change.

### Lift

`L = q * S * CL`

- `L`: lift force, in newtons (`N`)
- `q`: dynamic pressure
- `S`: wing area, in square meters (`m^2`)
- `CL`: lift coefficient

Lift is mostly perpendicular to the aircraft's velocity, not simply world-up. When the aircraft banks, the lift vector tilts sideways and turns the aircraft.

What changes lift:

- Higher `q`: more airspeed or denser air
- Higher `S`: bigger wing
- Higher `CL`: more lift coefficient from AoA

In the sim, `CL` is mainly controlled by angle of attack:

```text
CL roughly increases as AoA increases
CL is clamped near CLmax
CL degrades after stall AoA
```

This is why the debug log shows both `CL linear` and `CL used`. `CL linear` is the raw ideal value. `CL used` is the value after limits and stall behavior.

### Drag

`D = q * S * CD`

- `D`: drag force, in newtons (`N`)
- `q`: dynamic pressure
- `S`: wing area
- `CD`: drag coefficient

Drag points opposite the velocity vector. It increases strongly with speed and also increases when the aircraft pulls high angle of attack.

Drag is why a dive can accelerate quickly but a steep climb bleeds speed. More speed means more `q`, and more `q` means more drag. High AoA also increases `CD`, which adds even more drag.

### Drag Coefficient Breakdown

`CD = CD0 + k * CL^2 + CD_highAoA`

- `CD`: total drag coefficient used by the sim
- `CD0`: parasite drag, the baseline drag of the aircraft body
- `k * CL^2`: induced drag, drag caused by producing lift
- `CD_highAoA`: extra drag at high angle of attack
- `k`: induced drag factor, based on wing aspect ratio and efficiency

This is why pulling too hard can kill speed quickly: high `CL` and high AoA both increase drag.

The `k * CL^2` part matters a lot. Because `CL` is squared, doubling `CL` creates four times that induced-drag contribution.

### Thrust

`T = throttle * Tmax`

- `T`: thrust force, in newtons (`N`)
- `throttle`: pilot throttle setting from `0.0` to `1.0`
- `Tmax`: maximum engine thrust, in newtons (`N`)

Thrust points along the aircraft forward axis.

Thrust does not directly mean "speed." It is just one force. Whether the aircraft speeds up depends on thrust compared with drag.

That is why the debug log shows:

```text
Thrust / Drag
```

If it is above `1.0`, thrust is winning and speed can increase. If it is below `1.0`, drag is winning and speed tends to decay.

### Weight

`W = m * g`

- `W`: weight force, in newtons (`N`)
- `m`: aircraft mass, in kilograms (`kg`)
- `g`: gravity, `9.81 m/s^2`

Weight always points downward in world space.

For steady level flight, lift needs to roughly balance weight:

```text
L ~= W
Lift / Weight ~= 1.0
```

If `Lift / Weight` is below `1.0`, the aircraft cannot maintain altitude unless something changes: more speed, more AoA, less bank, or less weight.

### Side Force

`Y = q * Sside * CY`

- `Y`: side force, in newtons (`N`)
- `Sside`: approximate side area of the aircraft, in square meters (`m^2`)
- `CY`: side-force coefficient

Side force comes from sideslip. It helps push the aircraft back toward coordinated flight instead of letting it skid sideways forever.

Sideslip angle is beta (`beta`). If beta is large, the aircraft is moving sideways relative to where the nose points. That can waste energy and make turns feel messy.

### Acceleration

`a = Ftotal / m`

- `a`: acceleration, in meters per second squared (`m/s^2`)
- `Ftotal`: total force vector after adding lift, drag, thrust, weight, and side force
- `m`: aircraft mass

The code then integrates:

```js
velocity += acceleration * dt
position += velocity * dt
```

This is Newton's second law:

```text
F = m * a
so
a = F / m
```

All the force arrows in the debug view are pieces of `Ftotal`. The acceleration arrow shows what the sum of those forces is doing to the aircraft right now.

## Debug Log Glossary

### Debug Stats

- `FPS`: frames per second. Higher means smoother rendering and physics updates.
- `Visible Chunks`: terrain chunks currently passing visibility checks, shown as `visible / total loaded`.
- `Camera Mode`: either `chase` or `orbit`.
- `Camera`: world position of the camera as `(x, y, z)`.
- `Camera Target`: world point the orbit camera is looking at.
- `Plane`: world position of the aircraft as `(x, y, z)`.

### Flight State

- `Altitude`: aircraft height above world zero. This is `plane.position.y`, shown in meters and feet.
- `Airspeed`: `v`, the magnitude of the velocity vector, shown in `m/s` and `km/h`.
- `Vertical Speed`: `velocity.y`, climb or descent rate in `m/s`.
- `Pitch`: nose-up or nose-down angle relative to the horizon, in degrees.
- `Bank`: roll angle, in degrees. Positive/negative direction depends on the aircraft's current right/up axes.
- `Flight Path`: actual climb/descent angle of the velocity vector, in degrees. This can differ from pitch.
- `AoA`: angle of attack, usually written alpha (`alpha`). It is the angle between aircraft forward direction and the airflow in the pitch plane.
- `STALL`: appears when absolute AoA is beyond the stall angle and the lift curve is degraded.
- `Sideslip beta`: sideslip angle, usually written beta (`beta`). It is the sideways angle between aircraft forward direction and actual movement.
- `Throttle`: engine throttle percentage.
- `Local Velocity`: velocity transformed into aircraft-local coordinates `(right, up, forward/back)`.
- `Acceleration`: final acceleration vector after all forces are combined and divided by mass.

### Aero Formula Log

- `rho`: air density (`kg/m^3`). Lower at high altitude.
- `q = 0.5*rho*v^2`: dynamic pressure (`Pa`).
- `CL linear`: the raw linear lift coefficient before stall/clamping.
- `CL used`: the final lift coefficient after stall and coefficient limits.
- `CD = CD0 + k*CL^2 + highAoA`: the drag coefficient breakdown.
- `L = q*S*CL`: lift equation result.
- `D = q*S*CD`: drag equation result.
- `T = throttle*Tmax`: thrust equation result.
- `W = m*g`: weight equation result.
- `Y = q*Sside*CY`: side-force equation result.
- `a = F/m`: acceleration result from total force divided by aircraft mass.
- `Lift / Weight`: `L / W`. Around `1.0` means lift equals weight. Above `1.0` can climb or pull up, depending on direction.
- `Thrust / Drag`: `T / D`. Above `1.0` means thrust is greater than drag and the aircraft can accelerate.
- `Stall Speed`: estimated minimum speed for level flight at maximum lift coefficient.
- `Forces L/D/T/W/Y`: compact force list for lift, drag, thrust, weight, and side force.
- `Vector Arrows`: whether motion/force debug arrows are visible.
- `Reference`: whether reference arrows such as forward/up/right axes are visible.
- `Forces/Motion`: legend for non-reference arrows.
- `Reference`: legend for reference arrows.
- `Memory`: browser JavaScript heap usage when available.

## Important Symbols

| Symbol | Name | Meaning | Unit |
| --- | --- | --- | --- |
| `rho` | Air density | How dense the air is | `kg/m^3` |
| `v` | Airspeed | Magnitude of aircraft velocity | `m/s` |
| `q` | Dynamic pressure | `0.5 * rho * v^2` | `Pa` |
| `S` | Wing area | Main wing reference area | `m^2` |
| `Sside` | Side area | Approximate side-facing aircraft area | `m^2` |
| `CL` | Lift coefficient | How much lift the wing makes | unitless |
| `CD` | Drag coefficient | How much drag the aircraft makes | unitless |
| `CD0` | Parasite drag coefficient | Baseline body drag | unitless |
| `CY` | Side-force coefficient | Side force from sideslip | unitless |
| `L` | Lift | Aerodynamic lifting force | `N` |
| `D` | Drag | Aerodynamic resistance | `N` |
| `T` | Thrust | Engine force | `N` |
| `W` | Weight | Gravity force | `N` |
| `Y` | Side force | Sideways aerodynamic force | `N` |
| `Ftotal` | Total force | Sum of all force vectors | `N` |
| `m` | Mass | Aircraft mass | `kg` |
| `g` | Gravity | Gravitational acceleration | `m/s^2` |
| `a` | Acceleration | `Ftotal / m` | `m/s^2` |
| `alpha` | Angle of attack | Pitch-plane angle between airflow and aircraft forward | degrees/radians |
| `beta` | Sideslip angle | Sideways angle between airflow and aircraft forward | degrees/radians |

## How To Read The Debug Log While Flying

- If climbing is hard, check `Lift / Weight`, `Thrust / Drag`, `Airspeed`, and `AoA`.
- If `Lift / Weight` is below `1.0`, the aircraft cannot hold altitude unless lift direction or speed changes.
- If `Thrust / Drag` is below `1.0`, the aircraft is losing speed.
- If `AoA` is high and `STALL` appears, pulling back more will usually make the climb worse.
- If `Pitch` is high but `Flight Path` is low or negative, the aircraft is nose-up but still sinking.
- If `Sideslip beta` is high, the aircraft is skidding sideways and wasting energy.
- If `q` is low, the airspeed is too low for strong aerodynamic control.

## Vector Arrow Legend

Motion/force arrows:

- Cyan: velocity
- White: acceleration
- Green: lift
- Red: drag
- Orange: thrust
- Purple: weight
- Pink: side force
- Yellow: total force

Reference arrows:

- Blue: aircraft forward axis
- Bright green: aircraft up axis
- Red: aircraft right axis
- Pale green: lift direction
- Pale cyan: velocity direction

Reference arrows are useful for understanding the math, but they can add clutter. Use `F7` to toggle them.
