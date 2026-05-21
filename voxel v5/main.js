// =============================
// Full modified JS — Plane with local-space controls + banking + camera follow
// =============================
const CHUNK_SIZE = 50;
const RENDER_DISTANCE_NEAR = 5;
const RENDER_DISTANCE_MID = 12;
const RENDER_DISTANCE_FAR = 25;
const heightScale = 20;
const baseScale = 0.02;
const mountainScale = 0.003;
const hillScale = 0.04;
const flatnessFactor = 0.2;
const mountainHeightMultiplier = 4.0;
const hillHeightMultiplier = 0.1;
const snowLevel = 0.99 * heightScale * 2;
const chunks = new Map();

const simplex = new SimplexNoise();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.FogExp2(0x87ceeb, 0.0005);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100000);
camera.position.y = 10;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
renderer.setClearColor(0x87ceeb);

const controls = new THREE.PointerLockControls(camera, renderer.domElement);
document.addEventListener('click', () => controls.lock());

const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(50, 100, 50).normalize();
scene.add(light);

const frustum = new THREE.Frustum();
const viewProjectionMatrix = new THREE.Matrix4();

// =============================
// Debug Overlay
// =============================
let debugVisible = true;
const debugDiv = document.createElement('div');
debugDiv.style.position = 'fixed';
debugDiv.style.top = '10px';
debugDiv.style.left = '10px';
debugDiv.style.padding = '10px';
debugDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
debugDiv.style.color = '#0f0';
debugDiv.style.fontFamily = 'monospace';
debugDiv.style.fontSize = '14px';
debugDiv.style.borderRadius = '8px';
debugDiv.style.display = 'block';
debugDiv.style.zIndex = '9999';
document.body.appendChild(debugDiv);

document.addEventListener('keydown', (event) => {
    if (event.code === 'F5') {
        event.preventDefault();
        debugVisible = !debugVisible;
        debugDiv.style.display = debugVisible ? 'block' : 'none';
    }
});

let lastFrameTime = performance.now();
let fps = 0;
let visibleChunks = 0;
let totalChunks = 0;

function updateDebug(dt) {
    fps = Math.round(1000 / (dt || 16.67));
    let memUsage = 'N/A';
    if (performance.memory) {
        const usedMB = (performance.memory.usedJSHeapSize / 1048576).toFixed(2);
        const totalMB = (performance.memory.totalJSHeapSize / 1048576).toFixed(2);
        memUsage = `${usedMB} / ${totalMB} MB`;
    }
    if (debugVisible) {
        debugDiv.innerHTML = `
            <b>Debug Stats</b><br>
            FPS: ${fps}<br>
            Visible Chunks: ${visibleChunks}/${totalChunks}<br>
            Camera: (${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)})<br>
            Plane: (${plane.position.x.toFixed(1)}, ${plane.position.y.toFixed(1)}, ${plane.position.z.toFixed(1)})<br>
            Memory: ${memUsage}
        `;
    }
}

// =============================
// Terrain Generation (unchanged)
// =============================
function generateChunk(chunkX, chunkZ, lod = "near") {
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    const colors = [];
    const indices = [];

    let step = 1;
    let lodScale = 1.0;

    if (lod === "mid") {
        step = 2;
        lodScale = 0.5;
    } else if (lod === "far") {
        step = CHUNK_SIZE;
        lodScale = 0.1;
    }

    let minY = Infinity;
    let maxY = -Infinity;

    for (let x = 0; x < CHUNK_SIZE; x += step) {
        for (let z = 0; z < CHUNK_SIZE; z += step) {
            const worldX = x + chunkX * CHUNK_SIZE;
            const worldZ = z + chunkZ * CHUNK_SIZE;

            const baseHeight = simplex.noise2D(worldX * baseScale, worldZ * baseScale) * heightScale * flatnessFactor;
            const hillHeight = simplex.noise2D(worldX * hillScale, worldZ * hillScale) * heightScale * hillHeightMultiplier;
            const mountainHeight = Math.max(0, simplex.noise2D(worldX * mountainScale, worldZ * mountainScale)) * heightScale * mountainHeightMultiplier;

            const y = Math.floor((baseHeight + hillHeight + mountainHeight) * lodScale);

            vertices.push(x, y, z);

            if (y < minY) minY = y;
            if (y > maxY) maxY = y;

            if (y < heightScale * 0.3) {
                colors.push(0.47, 0.8, 0.47);
            } else if (y < snowLevel) {
                colors.push(0.5, 0.5, 0.5);
            } else {
                colors.push(1.0, 1.0, 1.0);
            }

            if (x < CHUNK_SIZE - step && z < CHUNK_SIZE - step) {
                const row = CHUNK_SIZE / step;
                const a = (x / step) + (z / step) * row;
                const b = (x / step) + (z / step + 1) * row;
                const c = (x / step + 1) + (z / step) * row;
                const d = (x / step + 1) + (z / step + 1) * row;
                indices.push(a, b, c, b, d, c);
            }
        }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);

    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        side: THREE.DoubleSide,
        fog: true
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(chunkX * CHUNK_SIZE, 0, chunkZ * CHUNK_SIZE);
    mesh.visible = false;
    scene.add(mesh);

    geometry.computeBoundingBox();
    const bbox = geometry.boundingBox.clone();
    bbox.min.y = Math.min(minY - 10, bbox.min.y);
    bbox.max.y = Math.max(maxY + 10, bbox.max.y);
    mesh.userData.boundingBox = bbox;

    return mesh;
}

function isChunkInFrustum(chunk) {
    const box = chunk.userData.boundingBox.clone();
    box.applyMatrix4(chunk.matrixWorld);

    camera.updateMatrixWorld();
    viewProjectionMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjectionMatrix);

    return frustum.intersectsBox(box);
}

function updateChunks() {
    const cameraChunkX = Math.floor(camera.position.x / CHUNK_SIZE);
    const cameraChunkZ = Math.floor(camera.position.z / CHUNK_SIZE);

    for (let x = cameraChunkX - RENDER_DISTANCE_FAR; x <= cameraChunkX + RENDER_DISTANCE_FAR; x++) {
        for (let z = cameraChunkZ - RENDER_DISTANCE_FAR; z <= cameraChunkZ + RENDER_DISTANCE_FAR; z++) {
            const dx = Math.abs(x - cameraChunkX);
            const dz = Math.abs(z - cameraChunkZ);
            let lod = "far";
            if (dx <= RENDER_DISTANCE_NEAR && dz <= RENDER_DISTANCE_NEAR) lod = "near";
            else if (dx <= RENDER_DISTANCE_MID && dz <= RENDER_DISTANCE_MID) lod = "mid";

            const chunkKey = `${x},${z},${lod}`;
            if (!chunks.has(chunkKey)) {
                const chunk = generateChunk(x, z, lod);
                chunks.set(chunkKey, chunk);
            }
        }
    }

    visibleChunks = 0;

    chunks.forEach((chunk, key) => {
        const [chunkX, chunkZ, lod] = key.split(',').map((v, i) => i < 2 ? Number(v) : v);

        const dx = Math.abs(chunkX - cameraChunkX);
        const dz = Math.abs(chunkZ - cameraChunkZ);
        const inRange = dx <= RENDER_DISTANCE_FAR && dz <= RENDER_DISTANCE_FAR;

        if (!inRange) {
            scene.remove(chunk);
            chunk.geometry.dispose();
            chunks.delete(key);
        } else {
            chunk.visible = isChunkInFrustum(chunk);
            if (chunk.visible) visibleChunks++;
        }
    });

    totalChunks = chunks.size;
}

// =============================
// Plane (Cuboid) + Movement Model
// =============================
const planeGeometry = new THREE.BoxGeometry(4, 1, 8);
const planeMaterial = new THREE.MeshStandardMaterial({ color: 0xff3aae, metalness: 0.2, roughness: 0.6 });
const plane = new THREE.Mesh(planeGeometry, planeMaterial);
scene.add(plane);
plane.position.set(0, 60, 0);

// helper arrow to show forward (optional)
// const forwardHelper = new THREE.ArrowHelper(new THREE.Vector3(0,0,-1), plane.position, 10, 0x00ff00);
// scene.add(forwardHelper);

// Movement & rotation state (rates are in radians/sec or units/sec)
let speed = 300; // forward speed (units per second)
let throttle = 1.0; // multiplier (not exposed here, but easy to add)
const pitchSpeed = THREE.MathUtils.degToRad(60); // deg/s -> rad/s for pitch
const rollSpeed = THREE.MathUtils.degToRad(100); // roll
const yawSpeed = THREE.MathUtils.degToRad(40); // yaw
const angularDamping = 2.0; // damping factor for angular velocities

// Angular velocities in local space (rad/s)
const angVel = new THREE.Vector3(0, 0, 0); // x: pitch, y: yaw, z: roll

// Auto-bank when yawing: target roll angle (radians) to lean into turns
let targetBank = 0;
const maxAutoBank = THREE.MathUtils.degToRad(40);
const autoBankStrength = 1.2; // how strongly yaw causes bank (multiplier)
const bankLerpSpeed = 3.0; // how quickly plane adjusts roll to targetBank

// =============================
// Keyboard + Movement
// =============================
const keyboard = {};
document.addEventListener('keydown', (event) => keyboard[event.code] = true);
document.addEventListener('keyup', (event) => keyboard[event.code] = false);

// Prevent page scroll when using keys
window.addEventListener("keydown", function(e) {
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].indexOf(e.code) > -1) {
        e.preventDefault();
    }
}, false);

// =============================
// Camera follow params
// =============================
const cameraOffset = new THREE.Vector3(0, 5, 18); // camera relative to plane in local space (behind & above)
const cameraLerp = 0.12; // smoothing for camera position
const lookAtLerp = 0.25; // smoothing for camera lookAt target

let cameraTargetPos = new THREE.Vector3();
let cameraLookAtPos = new THREE.Vector3();

// =============================
// Update plane using local-space rotations
// =============================
function updatePlane(dt) {
  // Inputs (local-space)
  const pitchInput = (keyboard['KeyW'] ?  1 : 0) + (keyboard['KeyS'] ? -1 : 0); // nose down/up
  const rollInput  = (keyboard['KeyA'] ?  1 : 0) + (keyboard['KeyD'] ? -1 : 0); // roll left/right
  const yawInput   = (keyboard['KeyQ'] ?  1 : 0) + (keyboard['KeyE'] ? -1 : 0); // yaw left/right

  // Desired local angular rates (rad/s)
  const desiredPitch = pitchInput * pitchSpeed;
  const desiredRoll  = rollInput  * rollSpeed;
  const desiredYaw   = yawInput   * yawSpeed;

  // Smooth to desired rates
  const angBlend = Math.min(1, 8 * dt);
  angVel.x += (desiredPitch - angVel.x) * angBlend;
  angVel.y += (desiredYaw   - angVel.y) * angBlend;
  angVel.z += (desiredRoll  - angVel.z) * angBlend;

  // Damps velocity, NOT orientation (no auto-level)
  angVel.multiplyScalar(Math.max(0, 1 - angularDamping * dt));

  // Apply local-space rotation + forward motion
  plane.rotateX(angVel.x * dt);
  plane.rotateY(angVel.y * dt);
  plane.rotateZ(angVel.z * dt);
  plane.translateZ(-speed * throttle * dt);

  if (plane.position.y < 2) plane.position.y = 2;
}


// Utility: normalize angle to [-PI, PI]
function normalizeAngle(a) {
    return Math.atan2(Math.sin(a), Math.cos(a));
}

// Utility: shortest signed difference from a to b (both radians)
function shortestAngleDiff(a, b) {
    const diff = normalizeAngle(b - a);
    return diff;
}

// =============================
// Smooth camera follow behind the plane
// =============================
function updateCamera(dt) {
    // Position camera relative to plane
    const worldOffset = cameraOffset.clone().applyQuaternion(plane.quaternion);
    camera.position.copy(plane.position).add(worldOffset);

    // Lock orientation to plane
    camera.quaternion.copy(plane.quaternion);
}


// =============================
// Animation Loop
// =============================
function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const dt = Math.min(0.05, (now - lastFrameTime) / 1000); // clamp dt to avoid huge steps
    lastFrameTime = now;

    updateChunks();
    updatePlane(dt);
    updateCamera(dt);
    updateDebug((now - lastFrameTime) || (dt * 1000));

    renderer.render(scene, camera);
}

animate();

// =============================
// Resize handling
// =============================
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// =============================
// Helpers & notes
// =============================
// - Controls are local to the plane (rotateX/Y/Z). W/S pitch the nose (relative), A/D roll (manual), Q/E yaw (rudder).
// - Auto-banking leans the plane into yaw turns; manual roll input overrides when present.
// - Forward motion uses translateZ(-speed * dt) so it's always relative to the nose direction.
// - Tweak pitchSpeed / rollSpeed / yawSpeed / speed / autoBankStrength to change handling feel.
