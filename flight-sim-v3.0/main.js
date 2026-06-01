import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { updateChunks, getChunkStats, toggleGapMode, getShowGaps, toggleWireframe, getWireframe } from './src/world.js';
import { getTerrainColorAt, getTerrainStats } from './src/terrain.js';
import {
    initPhysics,
    updatePlane,
    getPlane,
    getFlightState,
    getPhysicsStats,
    getAircraftPresetList,
    getActiveAircraftKey,
    setActiveAircraft,
    getCollisionsEnabled,
    setCollisionsEnabled,
    isCrashed,
    getCrashInfo,
    onCrash,
    resetAircraft,
    getDebugVectorLegend,
    setDebugReferenceVectorsVisible,
    setDebugVectorsVisible
} from './src/physics.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.FogExp2(0x87ceeb, 0.0005);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100000);
camera.position.y = 10;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
renderer.setClearColor(0x87ceeb);
renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());

const cameraControls = new OrbitControls(camera, renderer.domElement);
cameraControls.enableDamping = true;
cameraControls.dampingFactor = 0.08;
cameraControls.enablePan = true;
cameraControls.screenSpacePanning = true;
cameraControls.enableKeys = false;
cameraControls.rotateSpeed = 0.75;
cameraControls.panSpeed = 0.85;
cameraControls.zoomSpeed = 0.9;
cameraControls.minDistance = 8;
cameraControls.maxDistance = 220;
cameraControls.enabled = false;

const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(50, 100, 50).normalize();
scene.add(light);

initPhysics(scene);

const frustum = new THREE.Frustum();
const viewProjectionMatrix = new THREE.Matrix4();
const cameraFollowTarget = new THREE.Vector3().copy(getPlane().position);
const cameraTargetDelta = new THREE.Vector3();
const defaultCameraOffset = new THREE.Vector3(0, 5, 18);
const debugVectorLegend = getDebugVectorLegend().filter((entry) => !entry.reference).map((entry) =>
    `<span style="white-space:nowrap;"><span style="display:inline-block;width:0.8em;height:0.8em;background:${entry.color};margin-right:4px;"></span>${entry.label}</span>`
).join(' ');
const debugReferenceLegend = getDebugVectorLegend().filter((entry) => entry.reference).map((entry) =>
    `<span style="white-space:nowrap;"><span style="display:inline-block;width:0.8em;height:0.8em;background:${entry.color};margin-right:4px;"></span>${entry.label}</span>`
).join(' ');

let cameraMode = 'chase';
let debugVisible = true;
let debugArrowsVisible = true;
let debugReferenceArrowsVisible = false;
let flightInstrumentVisible = true;
let minimapVisible = true;

function applyDebugArrowVisibility() {
    setDebugVectorsVisible(debugVisible && debugArrowsVisible);
    setDebugReferenceVectorsVisible(debugReferenceArrowsVisible);
}

function resetChaseCamera() {
    const plane = getPlane();
    const worldOffset = defaultCameraOffset.clone().applyQuaternion(plane.quaternion);
    cameraMode = 'chase';
    cameraControls.enabled = false;
    camera.position.copy(plane.position).add(worldOffset);
    cameraControls.target.copy(plane.position);
    cameraFollowTarget.copy(plane.position);
    camera.quaternion.copy(plane.quaternion);
}

function enterOrbitCamera() {
    if (cameraMode === 'orbit') return;
    cameraMode = 'orbit';
    cameraControls.enabled = true;
    cameraControls.target.copy(getPlane().position);
    cameraFollowTarget.copy(getPlane().position);
    cameraControls.update();
}

resetChaseCamera();
applyDebugArrowVisibility();

renderer.domElement.addEventListener('pointerdown', (event) => {
    if (event.button <= 2) enterOrbitCamera();
}, true);

const debugDiv = document.createElement('div');
debugDiv.style.position = 'fixed';
debugDiv.style.top = '10px';
debugDiv.style.left = '10px';
debugDiv.style.padding = '10px';
debugDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
debugDiv.style.color = '#0f0';
debugDiv.style.fontFamily = 'monospace';
debugDiv.style.fontSize = '12px';
debugDiv.style.lineHeight = '1.35';
debugDiv.style.borderRadius = '8px';
debugDiv.style.display = 'block';
debugDiv.style.zIndex = '9999';
debugDiv.style.maxWidth = '520px';
debugDiv.style.maxHeight = '85vh';
debugDiv.style.overflowY = 'auto';
document.body.appendChild(debugDiv);

const instrumentDiv = document.createElement('div');
instrumentDiv.style.position = 'fixed';
instrumentDiv.style.right = '18px';
instrumentDiv.style.bottom = '18px';
instrumentDiv.style.width = '220px';
instrumentDiv.style.height = '220px';
instrumentDiv.style.border = '3px solid rgba(255, 255, 255, 0.9)';
instrumentDiv.style.borderRadius = '50%';
instrumentDiv.style.overflow = 'hidden';
instrumentDiv.style.background = '#111';
instrumentDiv.style.boxShadow = '0 0 0 2px rgba(0, 0, 0, 0.75), 0 10px 30px rgba(0, 0, 0, 0.4)';
instrumentDiv.style.zIndex = '9998';
instrumentDiv.style.display = 'block';
instrumentDiv.style.pointerEvents = 'none';
document.body.appendChild(instrumentDiv);

const horizonBand = document.createElement('div');
horizonBand.style.position = 'absolute';
horizonBand.style.left = '-90px';
horizonBand.style.top = '-90px';
horizonBand.style.width = '400px';
horizonBand.style.height = '400px';
horizonBand.style.background = 'linear-gradient(to bottom, #4fa3ff 0%, #4fa3ff 49.4%, #ffffff 49.4%, #ffffff 50.6%, #8b5a2b 50.6%, #8b5a2b 100%)';
horizonBand.style.transformOrigin = '50% 50%';
instrumentDiv.appendChild(horizonBand);

const pitchLadder = document.createElement('div');
pitchLadder.style.position = 'absolute';
pitchLadder.style.left = '0';
pitchLadder.style.top = '0';
pitchLadder.style.width = '100%';
pitchLadder.style.height = '100%';
pitchLadder.style.transformOrigin = '50% 50%';
pitchLadder.style.color = '#fff';
pitchLadder.style.font = '11px monospace';
pitchLadder.style.textShadow = '0 1px 2px #000';
horizonBand.appendChild(pitchLadder);

[-30, -20, -10, 10, 20, 30].forEach((pitchMark) => {
    const mark = document.createElement('div');
    mark.style.position = 'absolute';
    mark.style.left = '50%';
    mark.style.top = `${200 - pitchMark * 3}px`;
    mark.style.width = '74px';
    mark.style.height = '1px';
    mark.style.background = 'rgba(255, 255, 255, 0.9)';
    mark.style.transform = 'translateX(-50%)';

    const labelLeft = document.createElement('span');
    labelLeft.textContent = `${Math.abs(pitchMark)}`;
    labelLeft.style.position = 'absolute';
    labelLeft.style.left = '-26px';
    labelLeft.style.top = '-6px';

    const labelRight = document.createElement('span');
    labelRight.textContent = `${Math.abs(pitchMark)}`;
    labelRight.style.position = 'absolute';
    labelRight.style.right = '-26px';
    labelRight.style.top = '-6px';

    mark.appendChild(labelLeft);
    mark.appendChild(labelRight);
    pitchLadder.appendChild(mark);
});

const aircraftSymbol = document.createElement('div');
aircraftSymbol.style.position = 'absolute';
aircraftSymbol.style.left = '50%';
aircraftSymbol.style.top = '50%';
aircraftSymbol.style.width = '122px';
aircraftSymbol.style.height = '28px';
aircraftSymbol.style.transform = 'translate(-50%, -50%)';
aircraftSymbol.style.borderTop = '3px solid #ffea00';
aircraftSymbol.style.borderLeft = '3px solid transparent';
aircraftSymbol.style.borderRight = '3px solid transparent';
aircraftSymbol.style.zIndex = '2';
instrumentDiv.appendChild(aircraftSymbol);

const aircraftDot = document.createElement('div');
aircraftDot.style.position = 'absolute';
aircraftDot.style.left = '50%';
aircraftDot.style.top = '50%';
aircraftDot.style.width = '10px';
aircraftDot.style.height = '10px';
aircraftDot.style.border = '2px solid #ffea00';
aircraftDot.style.borderRadius = '50%';
aircraftDot.style.transform = 'translate(-50%, -50%)';
aircraftDot.style.zIndex = '3';
instrumentDiv.appendChild(aircraftDot);

const bankPointer = document.createElement('div');
bankPointer.style.position = 'absolute';
bankPointer.style.left = '50%';
bankPointer.style.top = '8px';
bankPointer.style.width = '0';
bankPointer.style.height = '0';
bankPointer.style.borderLeft = '7px solid transparent';
bankPointer.style.borderRight = '7px solid transparent';
bankPointer.style.borderBottom = '12px solid #fff';
bankPointer.style.transform = 'translateX(-50%)';
bankPointer.style.zIndex = '4';
instrumentDiv.appendChild(bankPointer);

const instrumentReadout = document.createElement('div');
instrumentReadout.style.position = 'absolute';
instrumentReadout.style.left = '0';
instrumentReadout.style.right = '0';
instrumentReadout.style.bottom = '18px';
instrumentReadout.style.textAlign = 'center';
instrumentReadout.style.color = '#fff';
instrumentReadout.style.font = '12px monospace';
instrumentReadout.style.textShadow = '0 1px 3px #000';
instrumentReadout.style.zIndex = '4';
instrumentDiv.appendChild(instrumentReadout);

const minimapContainer = document.createElement('div');
minimapContainer.style.position = 'fixed';
minimapContainer.style.right = '18px';
minimapContainer.style.top = '18px';
minimapContainer.style.width = '220px';
minimapContainer.style.height = '220px';
minimapContainer.style.padding = '8px';
minimapContainer.style.background = 'rgba(0, 0, 0, 0.72)';
minimapContainer.style.border = '2px solid rgba(255, 255, 255, 0.85)';
minimapContainer.style.borderRadius = '8px';
minimapContainer.style.boxSizing = 'border-box';
minimapContainer.style.zIndex = '9997';
minimapContainer.style.pointerEvents = 'none';
document.body.appendChild(minimapContainer);

const minimapCanvas = document.createElement('canvas');
minimapCanvas.width = 192;
minimapCanvas.height = 192;
minimapCanvas.style.width = '192px';
minimapCanvas.style.height = '192px';
minimapCanvas.style.display = 'block';
minimapCanvas.style.imageRendering = 'pixelated';
minimapCanvas.style.background = '#111';
minimapContainer.appendChild(minimapCanvas);

const minimapReadout = document.createElement('div');
minimapReadout.style.color = '#fff';
minimapReadout.style.font = '11px monospace';
minimapReadout.style.marginTop = '4px';
minimapReadout.style.textAlign = 'center';
minimapReadout.style.textShadow = '0 1px 2px #000';
minimapContainer.appendChild(minimapReadout);

const minimapCtx = minimapCanvas.getContext('2d');
const minimapImage = minimapCtx.createImageData(minimapCanvas.width, minimapCanvas.height);
const minimapForward = new THREE.Vector3();
const MINIMAP_WORLD_SIZE = 900;
const MINIMAP_SAMPLE_STEP = MINIMAP_WORLD_SIZE / minimapCanvas.width;
const MINIMAP_INTERVAL = 250;
let lastMinimapUpdate = 0;

document.addEventListener('keydown', (event) => {
    if (event.code === 'KeyF' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        flightInstrumentVisible = !flightInstrumentVisible;
        instrumentDiv.style.display = flightInstrumentVisible ? 'block' : 'none';
    } else if (event.code === 'KeyM' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        minimapVisible = !minimapVisible;
        minimapContainer.style.display = minimapVisible ? 'block' : 'none';
    } else if (event.code === 'F5') {
        event.preventDefault();
        debugVisible = !debugVisible;
        debugDiv.style.display = debugVisible ? 'block' : 'none';
        applyDebugArrowVisibility();
    } else if (event.code === 'F6') {
        event.preventDefault();
        debugArrowsVisible = !debugArrowsVisible;
        applyDebugArrowVisibility();
    } else if (event.code === 'F7') {
        event.preventDefault();
        debugReferenceArrowsVisible = !debugReferenceArrowsVisible;
        applyDebugArrowVisibility();
    } else if (event.code === 'KeyC' && !event.ctrlKey && !event.metaKey) {
        resetChaseCamera();
    } else if (event.code === 'KeyJ' && !event.ctrlKey && !event.metaKey) {
        toggleGapMode(scene);
    } else if (event.code === 'KeyP' && !event.ctrlKey && !event.metaKey) {
        const presets = getAircraftPresetList();
        const current = getActiveAircraftKey();
        const idx = presets.findIndex(p => p.key === current);
        const next = presets[(idx + 1) % presets.length].key;
        setActiveAircraft(next);
        console.log(`Switched to: ${next}`);
    } else if (event.code === 'KeyK' && !event.ctrlKey && !event.metaKey) {
        setCollisionsEnabled(!getCollisionsEnabled());
        console.log(`Collisions: ${getCollisionsEnabled() ? 'ON' : 'OFF'}`);
    } else if (event.code === 'KeyU' && !event.ctrlKey && !event.metaKey) {
        const on = toggleWireframe();
        console.log(`Wireframe: ${on ? 'ON' : 'OFF'}`);
    }
});

let lastFrameTime = performance.now();
let fps = 0;
let lastDebugUpdate = 0;
const DEBUG_INTERVAL = 200;

function fmt(value, digits = 2) {
    return Number.isFinite(value) ? value.toFixed(digits) : 'NaN';
}

function fmtDeg(radians, digits = 1) {
    return fmt(THREE.MathUtils.radToDeg(radians), digits);
}

function fmtVector(vector, digits = 2) {
    if (!vector) return '(NaN, NaN, NaN)';
    return `(${fmt(vector.x, digits)}, ${fmt(vector.y, digits)}, ${fmt(vector.z, digits)})`;
}

function fmtForce(newtons) {
    return `${fmt(newtons / 1000, 2)} kN`;
}

function updateDebug(dt) {
    const now = performance.now();
    if (now - lastDebugUpdate < DEBUG_INTERVAL) return;
    lastDebugUpdate = now;

    fps = Math.round(1000 / (dt || 16.67));
    let memUsage = 'N/A';
    if (performance.memory) {
        const usedMB = (performance.memory.usedJSHeapSize / 1048576).toFixed(2);
        const totalMB = (performance.memory.totalJSHeapSize / 1048576).toFixed(2);
        memUsage = `${usedMB} / ${totalMB} MB`;
    }
    if (debugVisible) {
        const stats = getChunkStats();
        const plane = getPlane();
        const flight = getFlightState();
        debugDiv.innerHTML = `
            <b>Debug Stats</b><br>
            Aircraft: ${getActiveAircraftKey()} &nbsp; <b>P</b> cycles<br>
            Collisions: ${getCollisionsEnabled() ? 'ON' : 'OFF'} &nbsp; <b>K</b> toggles${isCrashed() ? ' <b>!! CRASHED !!</b>' : ''}<br>
            FPS: ${fps}<br>
            Wireframe: ${getWireframe() ? 'ON' : 'OFF'} &nbsp; <b>U</b> toggles<br>
            Visible Chunks: ${stats.visibleChunks}/${stats.totalChunks}<br>
            <b>Processing</b><br>
            Chunk Gen: ${stats.chunkGenTime.toFixed(1)} ms &nbsp; +${stats.chunksAdded}/-${stats.chunksRemoved}<br>
            Physics: ${getPhysicsStats().physicsTime.toFixed(2)} ms<br>
            Terrain Cache: ${(function(){ const t=getTerrainStats(); return `${t.tiles} tiles &nbsp; ${t.tileHits}H/${t.tileMisses}M &nbsp; gen:${t.tilesGenerated} evict:${t.tileEvictions}`; })()}<br>
            Chunks: ${getShowGaps() ? 'GAPPED (dev)' : 'SEAMLESS'} <b>J</b> toggles<br>
            Camera Mode: ${cameraMode}<br>
            Camera: (${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)})<br>
            Camera Target: (${cameraControls.target.x.toFixed(1)}, ${cameraControls.target.y.toFixed(1)}, ${cameraControls.target.z.toFixed(1)})<br>
            Plane: (${plane.position.x.toFixed(1)}, ${plane.position.y.toFixed(1)}, ${plane.position.z.toFixed(1)})<br>
            <br>
            <b>Flight State</b><br>
            Altitude: ${fmt(plane.position.y, 1)} m (${fmt(plane.position.y * 3.28084, 0)} ft)<br>
            Airspeed: ${fmt(flight.speed, 1)} m/s (${fmt(flight.speed * 3.6, 0)} km/h)<br>
            Vertical Speed: ${fmt(flight.verticalSpeed, 2)} m/s<br>
            Pitch / Bank: ${fmtDeg(flight.pitch)} deg / ${fmtDeg(flight.bank)} deg<br>
            Flight Path: ${fmtDeg(flight.flightPathAngle)} deg<br>
            AoA: ${fmtDeg(flight.aoa)} deg${flight.stalled ? ' STALL' : ''}<br>
            Sideslip beta: ${fmtDeg(flight.sideslip)} deg<br>
            Throttle: ${Math.round(flight.throttle * 100)}%<br>
            Local Velocity: ${fmtVector(flight.localVelocity, 2)} m/s<br>
            Acceleration: ${fmtVector(flight.acceleration, 2)} m/s^2<br>
            <br>
            <b>Aero Formula Log</b><br>
            rho: ${fmt(flight.rho, 3)} kg/m^3<br>
            q = 0.5*rho*v^2: ${fmt(flight.dynamicPressure, 1)} Pa<br>
            CL linear: ${fmt(flight.linearCl, 3)} | CL used: ${fmt(flight.cl, 3)}<br>
            CD = CD0 + k*CL^2 + highAoA: ${fmt(flight.parasiteCd, 3)} + ${fmt(flight.inducedCd, 3)} + ${fmt(flight.highAoACd, 3)} = ${fmt(flight.cd, 3)}<br>
            ${flight.formulas.lift}<br>
            ${flight.formulas.drag}<br>
            ${flight.formulas.thrust}<br>
            ${flight.formulas.weight}<br>
            ${flight.formulas.sideForce}<br>
            ${flight.formulas.acceleration}<br>
            Lift / Weight: ${fmt(flight.liftToWeight, 2)}<br>
            Thrust / Drag: ${fmt(flight.thrustToDrag, 2)}<br>
            Stall Speed: ${fmt(flight.stallSpeed, 1)} m/s<br>
            Forces L/D/T/W/Y: ${fmtForce(flight.lift)} / ${fmtForce(flight.drag)} / ${fmtForce(flight.thrust)} / ${fmtForce(flight.weight)} / ${fmtForce(flight.sideForce)}<br>
            Vector Arrows: ${debugArrowsVisible ? 'on' : 'off'} | Reference: ${debugReferenceArrowsVisible ? 'on' : 'off'}<br>
            Forces/Motion: ${debugVectorLegend}<br>
            Reference: ${debugReferenceLegend}<br>
            <br>
            Memory: ${memUsage}
        `;
    }
}

function updateFlightInstrument() {
    if (!flightInstrumentVisible) return;

    const plane = getPlane();
    const flight = getFlightState();
    const pitchDeg = THREE.MathUtils.radToDeg(flight.pitch);
    const bankDeg = THREE.MathUtils.radToDeg(flight.bank);
    const pitchOffset = THREE.MathUtils.clamp(pitchDeg * 3, -95, 95);

    horizonBand.style.transform = `translateY(${pitchOffset}px) rotate(${-bankDeg}deg)`;
    instrumentReadout.innerHTML = `ALT ${fmt(plane.position.y, 0)} m&nbsp;&nbsp; P ${fmt(pitchDeg, 0)}&deg;&nbsp;&nbsp; B ${fmt(bankDeg, 0)}&deg;`;
}

function drawMinimap(now) {
    if (!minimapVisible || now - lastMinimapUpdate < MINIMAP_INTERVAL) return;
    lastMinimapUpdate = now;

    const plane = getPlane();
    const halfMap = MINIMAP_WORLD_SIZE * 0.5;
    const width = minimapCanvas.width;
    const height = minimapCanvas.height;
    const data = minimapImage.data;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const worldX = plane.position.x + x * MINIMAP_SAMPLE_STEP - halfMap;
            const worldZ = plane.position.z + y * MINIMAP_SAMPLE_STEP - halfMap;
            const color = getTerrainColorAt(worldX, worldZ);
            const index = (x + y * width) * 4;

            data[index] = color.r;
            data[index + 1] = color.g;
            data[index + 2] = color.b;
            data[index + 3] = 255;
        }
    }

    minimapCtx.putImageData(minimapImage, 0, 0);

    const centerX = width * 0.5;
    const centerY = height * 0.5;
    minimapForward.set(0, 0, -1).applyQuaternion(plane.quaternion);
    const heading = Math.atan2(minimapForward.x, -minimapForward.z);

    minimapCtx.save();
    minimapCtx.translate(centerX, centerY);
    minimapCtx.rotate(heading);
    minimapCtx.fillStyle = '#ffea00';
    minimapCtx.strokeStyle = '#111';
    minimapCtx.lineWidth = 2;
    minimapCtx.beginPath();
    minimapCtx.moveTo(0, -12);
    minimapCtx.lineTo(8, 10);
    minimapCtx.lineTo(0, 5);
    minimapCtx.lineTo(-8, 10);
    minimapCtx.closePath();
    minimapCtx.fill();
    minimapCtx.stroke();
    minimapCtx.restore();

    minimapCtx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    minimapCtx.lineWidth = 1;
    minimapCtx.beginPath();
    minimapCtx.moveTo(centerX - 8, centerY);
    minimapCtx.lineTo(centerX + 8, centerY);
    minimapCtx.moveTo(centerX, centerY - 8);
    minimapCtx.lineTo(centerX, centerY + 8);
    minimapCtx.stroke();

    minimapReadout.textContent = `MAP ${MINIMAP_WORLD_SIZE} m | X ${fmt(plane.position.x, 0)} Z ${fmt(plane.position.z, 0)}`;
}

function updateOrbitCamera() {
    const plane = getPlane();

    if (cameraMode === 'chase') {
        const worldOffset = defaultCameraOffset.clone().applyQuaternion(plane.quaternion);
        camera.position.copy(plane.position).add(worldOffset);
        camera.quaternion.copy(plane.quaternion);
        cameraControls.target.copy(plane.position);
        cameraFollowTarget.copy(plane.position);
        return;
    }

    cameraTargetDelta.copy(plane.position).sub(cameraFollowTarget);
    camera.position.add(cameraTargetDelta);
    cameraControls.target.add(cameraTargetDelta);
    cameraFollowTarget.copy(plane.position);
    cameraControls.update();
}

const lastCameraPos = new THREE.Vector3();
const cameraVelocity = new THREE.Vector3();

// ---- profiler ----
const PROFILE = { active: false, samples: [], fc: 0, fsum: 0, gsum: 0, psum: 0, asum: 0, rsum: 0, t0: 0, maxFrames: 900, sampleEvery: 60 };
function startProfile() {
    PROFILE.active = true; PROFILE.samples = []; PROFILE.fc = 0; PROFILE.fsum = 0; PROFILE.gsum = 0; PROFILE.psum = 0; PROFILE.asum = 0; PROFILE.rsum = 0; PROFILE.t0 = performance.now();
    console.log('=== PROFILE START ===');
}
function stopProfile() {
    PROFILE.active = false;
    console.log('=== PROFILE STOP ===');
    if (!PROFILE.samples.length) return;
    const n = PROFILE.samples.length;
    const avg = k => PROFILE.samples.reduce((a,b)=>a+b[k],0)/n;
    const sum = k => PROFILE.samples.reduce((a,b)=>a+b[k],0);
    const last = PROFILE.samples[n-1];
    console.log('=== SUMMARY (per-sample avg where each sample = ~1s) ===');
    console.log(['avgFPS','avgGen(ms)','avgPhys(ms)','+chunks/s','-chunks/s','endChunks','endVisible','peakChunks','avgTileHits/s','avgTileMisses/s','totalTilesGen','totalTilesEvict','endMem(MB)'].join(','));
    console.log([avg('fps').toFixed(1), avg('gen').toFixed(2), avg('phy').toFixed(3), sum('ads').toFixed(0), sum('rem').toFixed(0), last.tch, last.vch, Math.max(...PROFILE.samples.map(s=>s.tch)), avg('th').toFixed(0), avg('tm').toFixed(0), last.tg, last.te, last.mem].join(','));
    console.log('Elapsed:', ((performance.now()-PROFILE.t0)/1000).toFixed(1)+'s');
}
document.addEventListener('keydown', (e) => { if (e.code==='F8') { e.preventDefault(); PROFILE.active ? stopProfile() : startProfile(); } });

// ---- crash explosion effect ----
const EXPLOSION_DURATION = 2000;
const EXPLOSION_PARTICLES = 200;
let explosionStart = 0;
let explosionMesh = null;
let _respawning = false;

function createExplosion(pos, speed) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(EXPLOSION_PARTICLES * 3);
    const colors = new Float32Array(EXPLOSION_PARTICLES * 3);
    const velocities = [];
    const spread = 20 + speed * 0.3;
    for (let i = 0; i < EXPLOSION_PARTICLES; i++) {
        const i3 = i * 3;
        positions[i3] = pos.x + (Math.random() - 0.5) * 4;
        positions[i3 + 1] = pos.y + (Math.random() - 0.5) * 4;
        positions[i3 + 2] = pos.z + (Math.random() - 0.5) * 4;
        const brightness = 0.5 + Math.random() * 0.5;
        colors[i3] = 1;
        colors[i3 + 1] = 0.4 + Math.random() * 0.3;
        colors[i3 + 2] = 0;
        velocities.push(new THREE.Vector3(
            (Math.random() - 0.5) * spread,
            Math.random() * spread * 0.8,
            (Math.random() - 0.5) * spread
        ));
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size: 3 + speed * 0.02,
        vertexColors: true,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    if (explosionMesh) {
        scene.remove(explosionMesh);
        explosionMesh.geometry.dispose();
        explosionMesh.material.dispose();
    }
    explosionMesh = new THREE.Points(geometry, material);
    explosionMesh.userData.velocities = velocities;
    scene.add(explosionMesh);
    explosionStart = performance.now();
}

function updateExplosion() {
    if (!explosionMesh) return;
    const elapsed = performance.now() - explosionStart;
    if (elapsed >= EXPLOSION_DURATION) {
        scene.remove(explosionMesh);
        explosionMesh.geometry.dispose();
        explosionMesh.material.dispose();
        explosionMesh = null;
        return;
    }
    const progress = elapsed / EXPLOSION_DURATION;
    const pos = explosionMesh.geometry.attributes.position;
    const vel = explosionMesh.userData.velocities;
    const dt = 1 / 60;
    for (let i = 0; i < EXPLOSION_PARTICLES; i++) {
        const i3 = i * 3;
        pos.array[i3] += vel[i].x * dt;
        pos.array[i3 + 1] += vel[i].y * dt;
        pos.array[i3 + 2] += vel[i].z * dt;
        vel[i].multiplyScalar(0.97);
    }
    pos.needsUpdate = true;
    explosionMesh.material.opacity = 1 - progress;
}

onCrash((pos, speed) => {
    createExplosion(pos, speed);
});

function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
    lastFrameTime = now;

    updatePlane(dt);
    updateOrbitCamera();

    camera.updateMatrixWorld();
    viewProjectionMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjectionMatrix);

    if (dt > 0) {
        cameraVelocity.subVectors(camera.position, lastCameraPos).divideScalar(dt);
    } else {
        cameraVelocity.set(0, 0, 0);
    }
    lastCameraPos.copy(camera.position);

    updateChunks(scene, camera, frustum, cameraVelocity.x, cameraVelocity.z);
    updateExplosion();

    if (isCrashed()) {
        const elapsed = now - explosionStart;
        if (explosionStart > 0 && elapsed > 3000 && !_respawning) {
            _respawning = true;
            resetAircraft();
            console.log('Respawned');
        } else if (!_respawning) {
            _respawning = false;
        }
    } else {
        _respawning = false;
    }

    if (PROFILE.active) {
        PROFILE.fc++;
        const s = getChunkStats();
        PROFILE.fsum += 1 / (dt || 1/60);
        PROFILE.gsum += s.chunkGenTime;
        PROFILE.asum += s.chunksAdded;
        PROFILE.rsum += s.chunksRemoved;

        const ps = getPhysicsStats();
        PROFILE.psum += ps.physicsTime;

        if (PROFILE.fc % PROFILE.sampleEvery === 0) {
            const ts = getTerrainStats();
            const smp = {
                fps: PROFILE.fsum / PROFILE.sampleEvery,
                gen: PROFILE.gsum,
                phy: PROFILE.psum,
                ads: PROFILE.asum,
                rem: PROFILE.rsum,
                tch: s.totalChunks,
                vch: s.visibleChunks,
                th: ts.tileHits, tm: ts.tileMisses, tg: ts.tilesGenerated, te: ts.tileEvictions,
                mem: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : 0
            };
            PROFILE.samples.push(smp);
            console.log(`S${PROFILE.samples.length-1}: ${smp.fps.toFixed(0)}fps gen=${smp.gen.toFixed(2)}ms phys=${smp.phy.toFixed(2)}ms +${smp.ads}/-${smp.rem} vis=${smp.vch}/${smp.tch} tiles=${ts.tiles}(${smp.th}H/${smp.tm}M/${smp.tg}G/${smp.te}E) mem=${smp.mem}MB`);
            PROFILE.fsum = 0; PROFILE.gsum = 0; PROFILE.psum = 0; PROFILE.asum = 0; PROFILE.rsum = 0;
        }

        if (PROFILE.fc >= PROFILE.maxFrames) stopProfile();
    }

    updateDebug(dt * 1000);
    updateFlightInstrument();
    drawMinimap(now);

    renderer.render(scene, camera);
}

animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
