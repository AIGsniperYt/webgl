# Flight Simulator

A browser-based 3D flight simulator built with Three.js featuring procedurally generated terrain and realistic flight controls.

## Features

- Realistic flight physics with pitch, roll, and yaw controls
- Procedurally generated terrain with varying levels of detail
- First-person cockpit view with camera following the plane
- Performance optimization with chunk-based rendering and frustum culling
- Debug overlay showing FPS, memory usage, and other metrics

## Controls

### Flight Controls
| Key | Action |
|-----|--------|
| **W** | Pitch down (nose down) |
| **S** | Pitch up (nose up) |
| **A** | Roll left |
| **D** | Roll right |
| **Q** | Yaw left |
| **E** | Yaw right |
| **Arrow Up** | Increase throttle |
| **Arrow Down** | Decrease throttle |
| **Space** | Airbrake (hold) |

### Camera Modes

| Key / Input | Action |
|-------------|--------|
| **Left mouse drag** | Orbit camera around plane |
| **Right/middle mouse drag** | Pan orbit camera around plane |
| **Mouse wheel** | Zoom orbit camera |
| **C** | Toggle freecam (detached camera) |
| **R** | In freecam: toggle plane freeze/release |
| **Freecam WASD** | Move camera forward/back/left/right |
| **Freecam Q/E** | Move camera down/up |
| **Freecam scroll** | Adjust freecam speed (×0.1–×50) |
| **Freecam click+drag** | Pan camera view |

### Display Toggles

| Key | Action |
|-----|--------|
| **F** | Toggle flight instrument panel |
| **M** | Toggle minimap |
| **G** | Toggle G-force overlay |
| **U** | Cycle wireframe mode (all LODs) |
| **O** | Cycle debug mode: Off → Panel → Arrows → Both |
| **F7** | Toggle HUD visibility |
| **J** | Toggle chunk gap mode (dev/player) |
| **K** | Toggle collisions on/off |
| **P** | Cycle aircraft preset

## Getting Started

1. Clone or download this repository
2. Open `index.html` in a modern web browser
3. Use the keyboard controls to fly, then drag the mouse when you want to inspect the force arrows.

## Technical Details

Built with:
- Three.js for 3D rendering
- Simplex Noise for terrain generation
- Custom flight physics implementation

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Feel free to fork this project and make improvements! If you create something amazing based on this code, I'd appreciate attribution.

## Acknowledgments

- Three.js team for the excellent WebGL library
- Contributors to Simplex Noise implementation
