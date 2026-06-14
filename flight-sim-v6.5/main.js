import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { updateChunks, getChunkStats, toggleGapMode, getShowGaps, toggleWireframe, getWireframe } from './src/world.js';
import { getTerrainStats, getHeightScaled } from './src/terrain.js';
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
    setDebugVectorsVisible,
    setSuppressFlightInputs,
    setFrozen
} from './src/physics.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.FogExp2(0x87ceeb, 0.0004);

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
const freeCamKeys = { w: false, a: false, s: false, d: false, q: false, e: false };
const freeCamBaseSpeed = 80;
let freeCamSpeedMul = 1;
let freeCamYaw = 0, freeCamPitch = 0;
let freeCamMouseDown = false;
let freeCamLastMX = 0, freeCamLastMY = 0;
const debugVectorLegend = getDebugVectorLegend().map((entry) =>
    `<span style="white-space:nowrap;"><span style="display:inline-block;width:0.8em;height:0.8em;background:${entry.color};margin-right:4px;"></span>${entry.label}</span>`
).join(' ');

let cameraMode = 'chase';
let debugVisible = false;
let debugArrowsVisible = false;
let gForceEffectEnabled = false;

function applyDebugArrowVisibility() {
    setDebugVectorsVisible(debugVisible && debugArrowsVisible);
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

let freecamPlaneFrozen = true;

function enterFreecam() {
    if (cameraMode === 'freecam') return;
    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    freeCamYaw = euler.y;
    freeCamPitch = euler.x;
    cameraMode = 'freecam';
    cameraControls.enabled = false;
    freecamPlaneFrozen = true;
    setSuppressFlightInputs(true);
    setFrozen(true);
}

function exitFreecam() {
    if (cameraMode !== 'freecam') return;
    cameraMode = 'chase';
    cameraControls.enabled = false;
    setSuppressFlightInputs(false);
    setFrozen(false);
    resetChaseCamera();
}

document.addEventListener('pointerdown', (event) => {
    if (cameraMode === 'freecam' && event.button === 0) {
        freeCamMouseDown = true;
        freeCamLastMX = event.clientX;
        freeCamLastMY = event.clientY;
    }
});

document.addEventListener('pointermove', (event) => {
    if (cameraMode === 'freecam' && freeCamMouseDown) {
        freeCamYaw -= (event.clientX - freeCamLastMX) * 0.005;
        freeCamPitch -= (event.clientY - freeCamLastMY) * 0.005;
        freeCamPitch = Math.max(-1.4, Math.min(1.4, freeCamPitch));
        freeCamLastMX = event.clientX;
        freeCamLastMY = event.clientY;
    }
});

document.addEventListener('pointerup', () => {
    if (cameraMode === 'freecam') freeCamMouseDown = false;
});

renderer.domElement.addEventListener('wheel', (event) => {
    if (cameraMode === 'freecam') {
        freeCamSpeedMul = Math.max(0.1, Math.min(50, freeCamSpeedMul * (event.deltaY > 0 ? 0.85 : 1.15)));
    }
}, { passive: true });

resetChaseCamera();
applyDebugArrowVisibility();

renderer.domElement.addEventListener('pointerdown', (event) => {
    if (event.button <= 2 && cameraMode !== 'freecam') enterOrbitCamera();
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
debugDiv.style.display = 'none';
debugDiv.style.zIndex = '9999';
debugDiv.style.maxWidth = '520px';
debugDiv.style.maxHeight = '85vh';
debugDiv.style.overflowY = 'auto';
document.body.appendChild(debugDiv);

// === F-16 HUD overlay (green combat HUD) ===
const hudCanvas = document.createElement('canvas');
hudCanvas.style.position = 'fixed';
hudCanvas.style.top = '0';
hudCanvas.style.left = '0';
hudCanvas.style.width = '100%';
hudCanvas.style.height = '100%';
hudCanvas.style.zIndex = '9998';
hudCanvas.style.pointerEvents = 'none';
hudCanvas.style.display = 'block';
document.body.appendChild(hudCanvas);

const hudCtx = hudCanvas.getContext('2d');
let hudVisible = true;

function resizeHUD() {
    hudCanvas.width = window.innerWidth;
    hudCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeHUD);
resizeHUD();

const HUD_PITCH_PX = 4;
const HUD_HEADING_PX = 3;
const HUD_SPEED_PX = 0.4;
const HUD_ALT_PX = 0.025;
const HUD_PITCH_RANGE = 90;
const HUD_HEADING_RANGE = 60;
const HUD_TAPE_HALF = 100;

const hudForward = new THREE.Vector3();
const hudUp = new THREE.Vector3();

const stallWarning = document.createElement('div');
stallWarning.innerHTML = `
  <div class="stall-kicker">AIRSPEED LOW</div>
  <div class="stall-main">STALL CONDITION</div>
  <div class="stall-sub">RECOVER IMMEDIATELY</div>
`;

Object.assign(stallWarning.style, {
  position: 'fixed',
  bottom: '12vh',
  left: '50%',
  transform: 'translateX(-50%) translateY(14px) scale(0.98)',
  transformOrigin: 'center',
  color: '#ff4b2e',
  fontFamily: 'monospace',
  textAlign: 'center',
  letterSpacing: '0.12em',
  padding: '10px 16px',
  border: '1px solid rgba(255, 70, 30, 0.35)',
  background: 'rgba(0,0,0,0.45)',
  boxShadow: '0 0 16px rgba(255, 34, 0, 0.18), inset 0 0 0 1px rgba(255,255,255,0.04)',
  zIndex: '10000',
  pointerEvents: 'none',
  display: 'none',
  opacity: '0',
  transition: 'opacity 120ms linear, transform 120ms linear, box-shadow 120ms linear, background 120ms linear',
  willChange: 'transform, opacity',
  minWidth: '240px'
});

stallWarning.querySelector('.stall-kicker').style.cssText = `
  font-size: 11px;
  opacity: 0.75;
  letter-spacing: 0.35em;
  margin-bottom: 4px;
`;

const stallMain = stallWarning.querySelector('.stall-main');
stallMain.style.cssText = `
  font-size: 34px;
  font-weight: bold;
  letter-spacing: 0.18em;
  text-shadow: 0 0 10px rgba(255,34,0,0.4);
`;

const stallSub = stallWarning.querySelector('.stall-sub');
stallSub.style.cssText = `
  font-size: 12px;
  opacity: 0.72;
  letter-spacing: 0.28em;
  margin-top: 4px;
`;

document.body.appendChild(stallWarning);

const gForceOverlay = document.createElement('div');
gForceOverlay.id = 'g-force-overlay';
Object.assign(gForceOverlay.style, {
  position: 'fixed',
  top: '0',
  left: '0',
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
  zIndex: '9999',
  transition: 'opacity 80ms linear',
  opacity: '0'
});
document.body.appendChild(gForceOverlay);

document.addEventListener('keydown', (event) => {
    if (event.code === 'KeyF' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        hudVisible = !hudVisible;
        hudCanvas.style.display = hudVisible ? 'block' : 'none';
    } else if (event.code === 'F5') {
        event.preventDefault();
        debugVisible = !debugVisible;
        debugDiv.style.display = debugVisible ? 'block' : 'none';
        applyDebugArrowVisibility();
    } else if (event.code === 'F6') {
        event.preventDefault();
        debugArrowsVisible = !debugArrowsVisible;
        applyDebugArrowVisibility();
    } else if (event.code === 'KeyG' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        gForceEffectEnabled = !gForceEffectEnabled;
        if (!gForceEffectEnabled) gForceOverlay.style.opacity = '0';
    } else if (event.code === 'KeyC' && !event.ctrlKey && !event.metaKey) {
        if (cameraMode === 'freecam') {
            exitFreecam();
        } else {
            enterFreecam();
        }
    } else if (event.code === 'KeyR' && !event.ctrlKey && !event.metaKey) {
        if (cameraMode === 'freecam') {
            freecamPlaneFrozen = !freecamPlaneFrozen;
            setSuppressFlightInputs(freecamPlaneFrozen);
            setFrozen(freecamPlaneFrozen);
        }
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
    } else if (event.code === 'KeyT' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        toggleTrail();
        console.log(`Wind trail: ${trailEnabled ? 'ON' : 'OFF'}`);
    }

    if (cameraMode === 'freecam') {
        switch (event.code) {
            case 'KeyW': freeCamKeys.w = true; break;
            case 'KeyA': freeCamKeys.a = true; break;
            case 'KeyS': freeCamKeys.s = true; break;
            case 'KeyD': freeCamKeys.d = true; break;
            case 'KeyQ': freeCamKeys.q = true; break;
            case 'KeyE': freeCamKeys.e = true; break;
        }
    }
});

document.addEventListener('keyup', (event) => {
    switch (event.code) {
        case 'KeyW': freeCamKeys.w = false; break;
        case 'KeyA': freeCamKeys.a = false; break;
        case 'KeyS': freeCamKeys.s = false; break;
        case 'KeyD': freeCamKeys.d = false; break;
        case 'KeyQ': freeCamKeys.q = false; break;
        case 'KeyE': freeCamKeys.e = false; break;
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
            Chunk Gen: ${stats.chunkGenTime.toFixed(1)} ms &nbsp; +${stats.chunksAdded}/-${stats.chunksRemoved}${stats.chunksMigrated > 0 ? ` mig:${stats.chunksMigrated}` : ''}${stats.pendingMigrations > 0 ? ` q:${stats.pendingMigrations}` : ''} &nbsp; ${stats.chunksHidden > 0 || stats.chunksUnhidden > 0 ? `h:${stats.chunksHidden}/u:${stats.chunksUnhidden}` : ''}${stats.frustumEvalTime > 0 ? ` &nbsp; fEval:${stats.frustumEvalTime.toFixed(2)}ms` : ''}<br>
            Physics: ${getPhysicsStats().physicsTime.toFixed(2)} ms<br>
            Terrain Cache: ${(function(){ const t=getTerrainStats(); return `${t.tiles} tiles &nbsp; ${t.tileHits}H/${t.tileMisses}M &nbsp; gen:${t.tilesGenerated} evict:${t.tileEvictions}`; })()}<br>
            Chunks: ${getShowGaps() ? 'GAPPED (dev)' : 'SEAMLESS'} <b>J</b> toggles<br>
            Camera Mode: ${cameraMode}${cameraMode === 'freecam' ? ` ×${freeCamSpeedMul.toFixed(1)} ${freecamPlaneFrozen ? '✈FROZEN' : '✈FREE LOCKED'}` : ''}<br>
            Camera: (${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)})<br>
            Camera Target: (${cameraControls.target.x.toFixed(1)}, ${cameraControls.target.y.toFixed(1)}, ${cameraControls.target.z.toFixed(1)})<br>
            Plane: (${plane.position.x.toFixed(1)}, ${plane.position.y.toFixed(1)}, ${plane.position.z.toFixed(1)})<br>
            <br>
            <b>Flight State</b><br>
            Altitude: ${fmt(plane.position.y, 1)} m &nbsp; AGL ${fmt(plane.position.y - getHeightScaled(plane.position.x, plane.position.z, 1.0), 1)} m (${fmt(plane.position.y * 3.28084, 0)} ft)<br>
            Airspeed: ${fmt(flight.speed, 1)} m/s (${fmt(flight.speed * 3.6, 0)} km/h)<br>
            Vertical Speed: ${fmt(flight.verticalSpeed, 2)} m/s<br>
            Pitch / Bank: ${fmtDeg(flight.pitch)} deg / ${fmtDeg(flight.bank)} deg<br>
            Flight Path: ${fmtDeg(flight.flightPathAngle)} deg<br>
            ${flight.canLand ? '<span style="color:#44ff44;font-weight:bold">READY TO LAND ✓</span>' : '<span style="color:#ff4444">NO LAND' +
            (!flight.pitchOk ? ' PITCH' : '') +
            (!flight.bankOk ? ' BANK' : '') +
            (!flight.descOk ? ' V/S' : '') +
            (!flight.speedOk ? ' SPD' : '') +
            '</span>'}<br>
            AoA: ${fmtDeg(flight.aoa)} deg${flight.stalled ? ' STALL' : ''}<br>
            Sideslip beta: ${fmtDeg(flight.sideslip)} deg<br>
            Throttle: ${Math.round(flight.throttle * 100)}% &nbsp; ${flight.airbrakes ? 'AIRBRAKE' : ''}<br>
            Local Velocity: ${fmtVector(flight.localVelocity, 2)} m/s<br>
            Acceleration: ${fmtVector(flight.acceleration, 2)} m/s^2<br>
            G-Force: ${fmt(flight.gForce, 2)} G &nbsp; <b>G</b> ${gForceEffectEnabled ? 'FX:ON' : 'FX:OFF'}${flight.gForce > 5 ? ' <span style="color:#ff4422;font-weight:bold">!! PULLING G !!</span>' : ''}<br>
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
            Vector Arrows: ${debugArrowsVisible ? 'on' : 'off'}<br>
            Forces/Motion: ${debugVectorLegend}<br>
            Wind Trail: <b>T</b> ${trailEnabled ? 'ON' : 'OFF'} (${trailPoints.length} pts)<br>
            <br>
            Memory: ${memUsage}
        `;
    }
}

function wrapDegrees(deg) {
    return ((deg % 360) + 360) % 360;
}

function updateHUD() {
    if (!hudVisible) return;

    const W = hudCanvas.width;
    const H = hudCanvas.height;
    hudCtx.clearRect(0, 0, W, H);

    const plane = getPlane();
    const flight = getFlightState();

    hudForward.set(0, 0, -1).applyQuaternion(plane.quaternion).normalize();
    hudUp.set(0, 1, 0).applyQuaternion(plane.quaternion).normalize();

    const pitchDeg = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(hudForward.y, -1, 1)));
    const headingDeg = wrapDegrees(THREE.MathUtils.radToDeg(Math.atan2(hudForward.x, -hudForward.z)));
    const speed = flight.speed;
    const alt = plane.position.y;
    const gForce = flight.gForce;
    const aoa = flight.aoa;
    const bankDeg = THREE.MathUtils.radToDeg(flight.bank);

    let cx, cy, scl;
    if (cameraMode === 'chase') {
        cx = W / 2;
        cy = H / 2;
        scl = 1;
    } else {
        cx = W - 130;
        cy = H - 130;
        scl = 0.55;
    }

    hudCtx.save();
    hudCtx.translate(cx, cy);
    hudCtx.scale(scl, scl);

    hudCtx.strokeStyle = '#0f0';
    hudCtx.fillStyle = '#0f0';
    hudCtx.lineWidth = 1;
    hudCtx.font = '13px monospace';
    hudCtx.textBaseline = 'middle';

    // ---- Pitch ladder (clipped to fixed centered window) ----
    const PITCH_WIN = 140;
    const PITCH_GAP = 65;
    const PITCH_MAX_LEN = 600;
    for (let p = -HUD_PITCH_RANGE; p <= HUD_PITCH_RANGE; p += 5) {
        const y = (pitchDeg - p) * HUD_PITCH_PX;
        if (Math.abs(y) > PITCH_WIN) continue;
        const isHorizon = p === 0;
        const is10 = p % 10 === 0;
        const halfLen = Math.min(PITCH_MAX_LEN, isHorizon ? W * 0.35 : is10 ? W * 0.22 : W * 0.12);
        if (isHorizon) hudCtx.lineWidth = 2.5;
        hudCtx.beginPath();
        hudCtx.moveTo(-halfLen, y);
        hudCtx.lineTo(-PITCH_GAP, y);
        hudCtx.stroke();
        hudCtx.beginPath();
        hudCtx.moveTo(PITCH_GAP, y);
        hudCtx.lineTo(halfLen, y);
        hudCtx.stroke();
        if (isHorizon) hudCtx.lineWidth = 1;
        if (is10 && p !== 0) {
            const lbl = `${Math.abs(p)}`;
            hudCtx.textAlign = 'right';
            hudCtx.fillText(lbl, -PITCH_GAP - 8, y);
            hudCtx.textAlign = 'left';
            hudCtx.fillText(lbl, PITCH_GAP + 8, y);
        }
    }

    // ---- Center reticle ----
    hudCtx.lineWidth = 1.5;
    hudCtx.beginPath();
    hudCtx.moveTo(-14, 0); hudCtx.lineTo(-5, 0);
    hudCtx.moveTo(5, 0); hudCtx.lineTo(14, 0);
    hudCtx.moveTo(0, -14); hudCtx.lineTo(0, -5);
    hudCtx.moveTo(0, 5); hudCtx.lineTo(0, 14);
    hudCtx.stroke();
    hudCtx.lineWidth = 1;

    // ---- Heading scale (wrapped compass) ----
    const hdgY = -H * 0.38;
    hudCtx.font = '13px monospace';
    hudCtx.textAlign = 'center';
    const hdgHalfW = HUD_HEADING_RANGE * HUD_HEADING_PX;
    hudCtx.beginPath();
    hudCtx.moveTo(-hdgHalfW, hdgY);
    hudCtx.lineTo(hdgHalfW, hdgY);
    hudCtx.stroke();
    for (let d = -HUD_HEADING_RANGE; d <= HUD_HEADING_RANGE; d++) {
        const h = headingDeg + d;
        const deg = ((h % 360) + 360) % 360;
        const x = d * HUD_HEADING_PX;
        const rounded = Math.round(deg);
        const is10 = rounded % 10 === 0;
        if (!is10) continue;
        if (d === 0) continue;
        const is30 = rounded % 30 === 0;
        const tickLen = is30 ? 10 : 5;
        hudCtx.beginPath();
        hudCtx.moveTo(x, hdgY + tickLen);
        hudCtx.lineTo(x, hdgY);
        hudCtx.stroke();
        if (is30) {
            hudCtx.fillText(`${rounded}`, x, hdgY + tickLen + 14);
        }
    }
    hudCtx.font = 'bold 16px monospace';
    hudCtx.fillText(`${Math.round(headingDeg)}°`, 0, hdgY - 8);

    // ---- Bank arc (moved above pitch ladder, near heading scale) ----
    const bankR = 60;
    const bankY = -H * 0.30;
    hudCtx.beginPath();
    hudCtx.arc(0, bankY, bankR, -Math.PI * 0.45, Math.PI * 0.45);
    hudCtx.stroke();
    hudCtx.save();
    hudCtx.translate(0, bankY);
    hudCtx.rotate(THREE.MathUtils.degToRad(bankDeg));
    hudCtx.beginPath();
    hudCtx.moveTo(0, bankR);
    hudCtx.lineTo(-4, bankR + 8);
    hudCtx.lineTo(4, bankR + 8);
    hudCtx.closePath();
    hudCtx.fill();
    hudCtx.restore();

    // ---- Airspeed tape (left) ----
    const spdX = -W * 0.4;
    const spdCenter = speed;
    hudCtx.font = 'bold 16px monospace';
    hudCtx.strokeRect(spdX - 28, -14, 42, 28);
    hudCtx.textAlign = 'center';
    hudCtx.fillText(`${Math.round(speed)}`, spdX - 7, 1);
    hudCtx.font = '13px monospace';
    for (let s = Math.floor((spdCenter - HUD_TAPE_HALF) / 10) * 10; s <= spdCenter + HUD_TAPE_HALF; s += 10) {
        if (s < 0) continue;
        const y = (spdCenter - s) * HUD_SPEED_PX;
        if (Math.abs(y) > HUD_TAPE_HALF * HUD_SPEED_PX * 0.5) continue;
        const is50 = s % 50 === 0;
        hudCtx.beginPath();
        hudCtx.moveTo(spdX + 14, y);
        hudCtx.lineTo(spdX + 14 + (is50 ? 10 : 5), y);
        hudCtx.stroke();
        if (is50) {
            hudCtx.textAlign = 'left';
            hudCtx.fillText(`${s}`, spdX + 28, y);
        }
    }

    // ---- Altitude tape (right) ----
    const altX = W * 0.4;
    const altCenter = alt;
    hudCtx.font = 'bold 16px monospace';
    hudCtx.strokeRect(altX - 14, -14, 44, 28);
    hudCtx.textAlign = 'center';
    hudCtx.fillText(`${Math.round(alt)}`, altX + 8, 1);
    hudCtx.font = '13px monospace';
    for (let a = Math.floor((altCenter - HUD_TAPE_HALF * 2.5) / 100) * 100; a <= altCenter + HUD_TAPE_HALF * 2.5; a += 100) {
        if (a < 0) continue;
        const y = (altCenter - a) * HUD_ALT_PX;
        if (Math.abs(y) > HUD_TAPE_HALF * HUD_ALT_PX * 0.5) continue;
        const is500 = a % 500 === 0;
        hudCtx.beginPath();
        hudCtx.moveTo(altX - 14, y);
        hudCtx.lineTo(altX - 14 - (is500 ? 10 : 5), y);
        hudCtx.stroke();
        if (is500) {
            hudCtx.textAlign = 'right';
            hudCtx.fillText(`${a}`, altX - 28, y);
        }
    }

    // ---- G / AoA ----
    hudCtx.textAlign = 'left';
    hudCtx.font = '12px monospace';
    const leftCol = -W * 0.42;
    const botRow = H * 0.35;
    hudCtx.fillText(`G  ${gForce.toFixed(1)}`, leftCol, botRow);
    hudCtx.fillText(`AoA ${THREE.MathUtils.radToDeg(aoa).toFixed(0)}°`, leftCol, botRow + 16);

    hudCtx.restore();
}

let _stallStart = 0;

function updateStallWarning() {
  const stalled = getFlightState().stalled;
  const crashed = isCrashed();
  const now = performance.now();

  if (!stalled || crashed) {
    _stallStart = 0;
    stallWarning.style.opacity = '0';
    stallWarning.style.transform = 'translateX(-50%) translateY(14px) scale(0.98)';
    if (stallWarning.style.display !== 'none') {
      stallWarning.style.display = 'none';
    }
    return;
  }

  if (_stallStart === 0) _stallStart = now;
  const age = now - _stallStart;
  const urgency = Math.min(1, age / 1200);
  const pulse = 0.5 + 0.5 * Math.sin(now * 0.018);
  const flash = 0.35 + 0.65 * pulse * urgency;

  const jitterX = Math.sin(now * 0.09) * (0.8 + urgency * 1.8);
  const jitterY = Math.cos(now * 0.12) * 0.6;
  const scale = 1 + urgency * 0.03 + pulse * 0.02;

  stallWarning.style.display = 'block';
  stallWarning.style.opacity = '0.96';
  stallWarning.style.transform =
    `translateX(calc(-50% + ${jitterX}px)) translateY(${jitterY}px) scale(${scale})`;

  stallWarning.style.borderColor = `rgba(255, 70, 30, ${0.35 + flash * 0.5})`;
  stallWarning.style.background = `rgba(0, 0, 0, ${0.45 + urgency * 0.16})`;
  stallWarning.style.boxShadow = `
    0 0 ${16 + flash * 24}px rgba(255, 34, 0, ${0.12 + flash * 0.22}),
    inset 0 0 0 1px rgba(255,255,255,0.04)
  `;

  stallMain.style.color = flash > 0.68 ? '#ffffff' : '#ff4b2e';
  stallMain.style.textShadow = `0 0 ${10 + flash * 14}px rgba(255,34,0,${0.4 + flash * 0.4})`;
  stallMain.style.letterSpacing = `${0.18 + urgency * 0.12}em`;

  stallSub.style.opacity = String(0.55 + urgency * 0.45);
}

function updateGForceEffect() {
  if (!gForceEffectEnabled) { gForceOverlay.style.opacity = '0'; return; }
  const g = getFlightState().gForce;
  const absG = Math.abs(g);
  const overG = Math.max(0, absG - 4);
  const severity = Math.min(1, overG / 5);
  const tunnelNarrow = Math.min(1, Math.max(0, absG - 5) / 4);

  const darken = severity * 0.85;
  const tunnelSize = 1 - tunnelNarrow * 0.55;
  const redTint = g < 0.8 ? Math.min(1, (0.8 - g) * 5) * 0.3 : 0;

  if (severity > 0 || redTint > 0) {
    gForceOverlay.style.opacity = Math.max(severity, redTint).toFixed(3);
    gForceOverlay.style.boxShadow = `inset 0 0 ${120 + severity * 200}px rgba(0,0,0,${darken})`;
    gForceOverlay.style.background = `radial-gradient(circle at center,
      transparent ${tunnelSize * 50}%,
      rgba(0,0,0,${darken * 0.7}) ${tunnelSize * 70}%,
      rgba(0,0,0,${darken}) ${tunnelSize * 90}%
    )`;
    if (redTint > 0) {
      gForceOverlay.style.background = `radial-gradient(circle at center,
        rgba(60,0,0,${redTint * 0.15}) ${tunnelSize * 40}%,
        rgba(80,0,0,${redTint * 0.3}) ${tunnelSize * 65}%,
        rgba(40,0,0,${redTint * 0.5}) ${tunnelSize * 85}%
      )`;
    }
  } else {
    gForceOverlay.style.opacity = '0';
  }
}

function updateOrbitCamera(dt) {
    const plane = getPlane();

    if (cameraMode === 'chase') {
        const worldOffset = defaultCameraOffset.clone().applyQuaternion(plane.quaternion);
        camera.position.copy(plane.position).add(worldOffset);
        camera.quaternion.copy(plane.quaternion);
        cameraControls.target.copy(plane.position);
        cameraFollowTarget.copy(plane.position);
        return;
    }

    if (cameraMode === 'freecam') {
        const euler = new THREE.Euler(freeCamPitch, freeCamYaw, 0, 'YXZ');
        const quat = new THREE.Quaternion().setFromEuler(euler);
        if (freecamPlaneFrozen) {
            const speed = freeCamBaseSpeed * freeCamSpeedMul * Math.min(dt, 0.05);
            const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
            const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
            if (freeCamKeys.w) camera.position.addScaledVector(dir, speed);
            if (freeCamKeys.s) camera.position.addScaledVector(dir, -speed);
            if (freeCamKeys.a) camera.position.addScaledVector(right, -speed);
            if (freeCamKeys.d) camera.position.addScaledVector(right, speed);
            if (freeCamKeys.e) camera.position.y += speed;
            if (freeCamKeys.q) camera.position.y -= speed;
        }
        camera.quaternion.copy(quat);
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
const PROFILE = { active: false, samples: [], fc: 0, ftotal: 0, gsum: 0, psum: 0, asum: 0, rsum: 0, t0: 0, maxFrames: 900, sampleEvery: 60 };
function startProfile() {
    PROFILE.active = true; PROFILE.samples = []; PROFILE.fc = 0; PROFILE.ftotal = 0; PROFILE.gsum = 0; PROFILE.psum = 0; PROFILE.asum = 0; PROFILE.rsum = 0; PROFILE.t0 = performance.now();
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

// ---- wind trail (smooth tube via CatmullRom) ----
const TRAIL_MAX = 500;
let trailEnabled = true;
const trailPoints = [];
let trailMesh = null;
let trailMaterial = null;
let trailTex = null;

function initTrail() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0, 'rgba(255,255,220,0.08)');
    grad.addColorStop(0.4, 'rgba(255,255,220,0.15)');
    grad.addColorStop(0.8, 'rgba(255,255,220,0.35)');
    grad.addColorStop(1, 'rgba(255,255,220,0.55)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 64);
    trailTex = new THREE.CanvasTexture(canvas);

    trailMaterial = new THREE.MeshBasicMaterial({
        map: trailTex, transparent: true, opacity: 0.65,
        depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    trailMesh = new THREE.Mesh(geo, trailMaterial);
    trailMesh.frustumCulled = false;
    trailMesh.renderOrder = 998;
    scene.add(trailMesh);
}

function buildTrailMesh() {
    if (trailPoints.length < 3) return;

    const curve = new THREE.CatmullRomCurve3(trailPoints);
    const tubularSegments = Math.min(96, trailPoints.length * 2);
    const radialSegments = 8;
    const radiusMin = 0.4;
    const radiusMax = 12.0;

    const vertCount = (tubularSegments + 1) * (radialSegments + 1);
    const pos = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const idx = [];

    const p = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const n = new THREE.Vector3();
    const b = new THREE.Vector3();
    let up = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i <= tubularSegments; i++) {
        const t = i / tubularSegments;
        curve.getPointAt(t, p);
        curve.getTangentAt(t, tan);

        if (Math.abs(tan.y) > 0.99) up.set(1, 0, 0);
        else up.set(0, 1, 0);
        n.crossVectors(up, tan).normalize();
        b.crossVectors(tan, n).normalize();

        const radius = radiusMin + (1 - t) * (radiusMax - radiusMin);

        for (let j = 0; j <= radialSegments; j++) {
            const theta = (j / radialSegments) * Math.PI * 2;
            const sin = Math.sin(theta);
            const cos = Math.cos(theta);
            const vi = i * (radialSegments + 1) + j;
            const i3 = vi * 3;
            pos[i3] = p.x + (n.x * cos + b.x * sin) * radius;
            pos[i3 + 1] = p.y + (n.y * cos + b.y * sin) * radius;
            pos[i3 + 2] = p.z + (n.z * cos + b.z * sin) * radius;
            uvs[vi * 2] = t;
            uvs[vi * 2 + 1] = j / radialSegments;
            if (i < tubularSegments && j < radialSegments) {
                const a = i * (radialSegments + 1) + j;
                const b2 = a + radialSegments + 1;
                idx.push(a, b2, a + 1, b2, b2 + 1, a + 1);
            }
        }
    }

    const newGeo = new THREE.BufferGeometry();
    newGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    newGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    newGeo.setIndex(idx);
    newGeo.computeVertexNormals();

    if (trailMesh.geometry) trailMesh.geometry.dispose();
    trailMesh.geometry = newGeo;
}

function updateTrail() {
    if (!trailEnabled) {
        if (trailMesh && trailMesh.parent) {
            scene.remove(trailMesh);
            if (trailMesh.geometry) trailMesh.geometry.dispose();
            trailMesh = null;
            trailPoints.length = 0;
        }
        return;
    }
    if (!trailMesh) initTrail();

    const p = getPlane();
    const offset = new THREE.Vector3(0, 0, 1).applyQuaternion(p.quaternion).multiplyScalar(4);
    trailPoints.push(p.position.clone().add(offset));
    while (trailPoints.length > TRAIL_MAX) trailPoints.shift();

    buildTrailMesh();
}

function toggleTrail() {
    trailEnabled = !trailEnabled;
    if (trailEnabled) {
        trailPoints.length = 0;
        if (!trailMesh) initTrail();
        else scene.add(trailMesh);
    } else {
        if (trailMesh) {
            scene.remove(trailMesh);
            if (trailMesh.geometry) trailMesh.geometry.dispose();
            trailMesh = null;
        }
    }
}

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
    const actualElapsedSeconds = (now - lastFrameTime) / 1000;

    // Use clamped dt strictly for physics/cameras to prevent clipping bugs
    const dt = Math.min(0.05, actualElapsedSeconds);
    lastFrameTime = now;

    // 1. Structural Updates
    updatePlane(dt);
    updateOrbitCamera(dt);

    // 2. Matrix & Frustum Operations
    camera.updateMatrixWorld();
    viewProjectionMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjectionMatrix);

    if (dt > 0) {
        cameraVelocity.subVectors(camera.position, lastCameraPos).divideScalar(dt);
    } else {
        cameraVelocity.set(0, 0, 0);
    }
    lastCameraPos.copy(camera.position);

    // 3. World Streamers
    updateChunks(scene, camera, frustum, cameraVelocity.x, cameraVelocity.z);
    updateExplosion();
    updateTrail();

    // 4. Respawn Logic
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

    // 5. FIXED PROFILER — uses actual (unclamped) time for correct FPS
    if (PROFILE.active) {
        PROFILE.fc++;
        const s = getChunkStats();
        PROFILE.ftotal += actualElapsedSeconds;
        PROFILE.gsum += s.chunkGenTime;
        PROFILE.asum += s.chunksAdded;
        PROFILE.rsum += s.chunksRemoved;

        const ps = getPhysicsStats();
        PROFILE.psum += ps.physicsTime;

        if (PROFILE.fc % PROFILE.sampleEvery === 0) {
            const ts = getTerrainStats();
            const smp = {
                fps: PROFILE.ftotal > 0 ? PROFILE.sampleEvery / PROFILE.ftotal : 0,
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

            PROFILE.ftotal = 0; PROFILE.gsum = 0; PROFILE.psum = 0; PROFILE.asum = 0; PROFILE.rsum = 0;
        }

        if (PROFILE.fc >= PROFILE.maxFrames) stopProfile();
    }

    // 6. WebGL Draw Call (before DOM updates for GPU/CPU parallelism)
    renderer.render(scene, camera);

    // 7. Post-Render UI Updates
    updateDebug(dt * 1000);
    updateHUD();
    updateStallWarning();
    updateGForceEffect();
}

initTrail();

animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
