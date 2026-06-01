import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js';
import { PointerLockControls } from 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/jsm/controls/PointerLockControls.js';

import { World } from './world.js';
import { PlanePhysics } from './physics.js';

// =============================
// Scene
// =============================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.FogExp2(0x87ceeb, 0.0005);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100000);
camera.position.y = 10;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x87ceeb);
document.body.appendChild(renderer.domElement);

// Pointer lock
const controls = new PointerLockControls(camera, renderer.domElement);
document.addEventListener('click', () => controls.lock());

// Light
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(50, 100, 50).normalize();
scene.add(light);

// =============================
// Systems
// =============================
const world = new World(scene, camera);
const planePhysics = new PlanePhysics(scene);

// =============================
// Input
// =============================
const keyboard = {};

document.addEventListener('keydown', (e) => keyboard[e.code] = true);
document.addEventListener('keyup', (e) => keyboard[e.code] = false);

window.addEventListener('keydown', (e) => {
  if (["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.code)) {
    e.preventDefault();
  }
}, false);

// =============================
// Camera follow
// =============================
const cameraOffset = new THREE.Vector3(0, 5, 18);

function updateCamera() {
  const plane = planePhysics.mesh;

  const worldOffset = cameraOffset.clone().applyQuaternion(plane.quaternion);
  camera.position.copy(plane.position).add(worldOffset);

  camera.quaternion.copy(plane.quaternion);
}

// =============================
// Debug
// =============================
let debugVisible = true;

const debugDiv = document.createElement('div');
debugDiv.style.position = 'fixed';
debugDiv.style.top = '10px';
debugDiv.style.left = '10px';
debugDiv.style.padding = '10px';
debugDiv.style.backgroundColor = 'rgba(0,0,0,0.7)';
debugDiv.style.color = '#0f0';
debugDiv.style.fontFamily = 'monospace';
debugDiv.style.fontSize = '14px';
debugDiv.style.borderRadius = '8px';
debugDiv.style.zIndex = '9999';
document.body.appendChild(debugDiv);

document.addEventListener('keydown', (e) => {
  if (e.code === 'F5') {
    e.preventDefault();
    debugVisible = !debugVisible;
    debugDiv.style.display = debugVisible ? 'block' : 'none';
  }
});

function updateDebug(dt) {
  const fps = Math.round(1 / (dt || 0.016));
  if (!debugVisible) return;

  debugDiv.innerHTML = `
    <b>Debug</b><br>
    FPS: ${fps}<br>
    Visible Chunks: ${world.visibleChunks}/${world.totalChunks}<br>
    Camera: (${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)})<br>
    Plane: (${planePhysics.mesh.position.x.toFixed(1)}, ${planePhysics.mesh.position.y.toFixed(1)}, ${planePhysics.mesh.position.z.toFixed(1)})
  `;
}

// =============================
// Loop
// =============================
let last = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  planePhysics.update(dt, keyboard);
  updateCamera();
  world.update(camera.position);
  updateDebug(dt);

  renderer.render(scene, camera);
}

animate();

// Resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});