# Flight Sim Engine Math Notes

This is a plain-language guide to the main 3D math terms used in the flight sim code. Most of these ideas answer a few practical questions:

- Where is the plane?
- Which way is it facing?
- How fast is it moving?
- How should it rotate?
- How do the instruments turn that into readable flight information?

## Quaternion

A quaternion is how Three.js stores rotation.

In normal language, we usually describe aircraft attitude with pitch, roll, and yaw:

- Pitch: nose up or down
- Roll/bank: wing tilt
- Yaw: nose left or right

Those are easy to understand, but they can become mathematically awkward when the aircraft gets near vertical or inverted. A common problem with simple angle-based rotation is called gimbal lock, where rotation axes start overlapping and the math loses a degree of freedom.

A quaternion avoids that. It stores orientation as four numbers internally, but you usually do not read those numbers directly. Instead, you use the quaternion to rotate vectors.

```js
instrumentForward.set(0, 0, -1).applyQuaternion(plane.quaternion);
```

That means:

Take the plane's local forward direction, `(0, 0, -1)`, and rotate it by the plane's current orientation so we know which way the plane is pointing in the world.

So in this codebase, `plane.quaternion` means the aircraft's real 3D attitude.

## Vector

A vector is a direction and/or amount in 3D space.

```js
new THREE.Vector3(0, 1, 0);
```

That means "up".

Common local aircraft directions are:

```js
(0, 0, -1) // forward
(0, 1, 0)  // up
(1, 0, 0)  // right
```

Vectors are used for:

- Position
- Velocity
- Acceleration
- Force
- Direction
- Camera offsets

Examples in the sim:

```js
plane.position
velocity
acceleration
forward
up
right
```

A position vector means where something is.

A velocity vector means which direction something is moving and how fast.

A force vector means which way a force is pushing and how strongly.

## Normalize

Normalize means: keep the direction, but make the vector's length exactly `1`.

```js
forward.normalize();
```

If a vector is `(10, 0, 0)`, it points right with length `10`. Normalized, it becomes `(1, 0, 0)`. Same direction, clean unit length.

This matters because direction vectors should not accidentally scale physics. Usually you want "which way is forward", not "forward multiplied by some weird leftover length".

## Euler Angles

Euler angles are rotations split into pitch, yaw, and roll.

They are human-readable:

```js
pitch // nose up/down
yaw   // nose left/right
roll  // wing tilt
```

The sim mostly stores the plane's real orientation as a quaternion, but it extracts readable angles for instruments and debug displays.

Example:

```js
flightState.bank = Math.atan2(right.y, up.y);
```

That computes bank from the aircraft's right and up vectors.

## Pitch

Pitch is nose up or nose down.

The older/simple pitch calculation looked like this:

```js
flight.pitch = Math.asin(forward.y);
```

That asks:

How much is the plane's forward direction pointing upward?

If `forward.y` is positive, the nose is up.

If `forward.y` is negative, the nose is down.

For the cyclic artificial horizon, the code uses a more wrap-friendly version:

```js
Math.atan2(instrumentForward.y, instrumentUp.y);
```

That lets the pitch continue around through vertical and inverted flight instead of behaving like it has a hard visual limit.

## Bank / Roll

Bank, or roll, is how much the aircraft is tilted sideways.

```js
Math.atan2(right.y, up.y);
```

This asks:

How much has the plane's right wing moved vertically compared to its up direction?

If one wing is higher than the other, you get a bank angle.

## Heading

Heading is compass direction: where the nose points across the ground.

```js
Math.atan2(instrumentForward.x, -instrumentForward.z);
```

This mostly ignores vertical pitch and asks:

Looking from above, which way is the plane facing?

The result is then wrapped into `0-360` degrees.

## atan2

`atan2(y, x)` gives an angle from two components.

It is better than plain `atan(y / x)` because it understands all four quadrants. That means it can tell the difference between angles like:

```js
45
135
-135
-45
```

The sim uses `atan2` for things like:

- Heading
- Bank
- Angle of attack
- Wrapped pitch

## asin

`asin()` gives an angle from a ratio between `-1` and `1`.

```js
Math.asin(forward.y);
```

If `forward.y` is `1`, the plane points straight up.

If `forward.y` is `0`, the plane is level.

If `forward.y` is `-1`, the plane points straight down.

This is good for simple pitch, but not enough for a full wraparound display because it cannot distinguish every orientation around a full 360 degree loop.

## Clamp

Clamp means: keep this value inside a range.

```js
THREE.MathUtils.clamp(value, -95, 95);
```

Before the artificial horizon was improved, the pitch display used a clamp. That made the instrument hit a hard limit. Past that point, the aircraft could keep pitching, but the instrument stopped moving.

That clamp was removed for the wraparound horizon.

## Modulo / Wrap

Wrapping means taking a number and looping it back into a range.

```js
((deg % 360) + 360) % 360;
```

This turns angles into `0-360`.

Examples:

```js
370  -> 10
-10  -> 350
720  -> 0
```

For the instrument, this makes the pitch tape circular. It comes back around instead of ending.

## Transform

CSS transforms are how the artificial horizon graphics move visually.

```js
horizonBand.style.transform =
    `translateY(${pitchOffset}px) rotate(${-bankDeg}deg)`;
```

That means:

Move the horizon up or down based on pitch, then rotate it based on bank.

The label readability fix does the opposite rotation:

```js
label.style.transform = `rotate(${bankDeg}deg)`;
```

So the horizon band rotates, but the pitch numbers stay readable.

## Local Space vs World Space

This is one of the biggest ideas in the sim.

Local space means directions relative to the plane itself:

```js
(0, 0, -1) // forward from the plane's point of view
(0, 1, 0)  // up from the plane's point of view
(1, 0, 0)  // right from the plane's point of view
```

World space means directions in the actual scene:

```js
Y // global up/down
X // global sideways
Z // global depth
```

When the code does this:

```js
applyQuaternion(plane.quaternion);
```

it converts a local direction into a world direction.

So the plane's forward direction is always `(0, 0, -1)` locally. But after applying the plane's quaternion, we know where that forward direction points in the world.

That one idea powers most of the flight math.

## Quick Mental Model

Think of the aircraft as carrying its own tiny coordinate system:

- Its own forward
- Its own up
- Its own right

The quaternion tells the engine how that tiny aircraft coordinate system is rotated inside the world.

The physics code uses that to calculate motion and forces.

The instrument code uses that to calculate pitch, bank, and heading.

The artificial horizon then turns those values into a readable display.
