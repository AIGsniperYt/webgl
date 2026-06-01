# Flight Simulator

A browser-based 3D flight simulator built with Three.js featuring procedurally generated terrain and realistic flight controls.

## Features

- Realistic flight physics with pitch, roll, and yaw controls
- Procedurally generated terrain with varying levels of detail
- First-person cockpit view with camera following the plane
- Performance optimization with chunk-based rendering and frustum culling
- Debug overlay showing FPS, memory usage, and other metrics

## Controls

- **W/S**: Pitch up/down
- **A/D**: Roll left/right
- **Q/E**: Yaw left/right
- **Shift/Ctrl**: Increase/decrease throttle
- **Left mouse drag**: Switch from chase camera to orbit camera
- **Right/middle mouse drag**: Switch from chase camera to panning orbit camera
- **Mouse wheel**: Zoom camera
- **C**: Return to chase camera
- **J**: Toggle chunk gap mode (dev: visible gaps / player: seamless terrain)
- **F**: Toggle flight instrument
- **M**: Toggle minimap
- **F5**: Toggle debug information
- **F6**: Toggle debug vector arrows
- **F7**: Toggle reference arrows such as forward/right/up axes

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
