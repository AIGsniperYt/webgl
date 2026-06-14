import * as THREE from 'three';
import { getHeightScaled } from './terrain.js';

const planeGeometry = new THREE.BoxGeometry(4, 1, 8);
const planeMaterial = new THREE.MeshStandardMaterial({ color: 0xff3aae, metalness: 0.2, roughness: 0.6 });
const plane = new THREE.Mesh(planeGeometry, planeMaterial);

let throttle = 1.0;
const velocity = new THREE.Vector3();
const acceleration = new THREE.Vector3();

const AIR_DENSITY_SEA_LEVEL = 1.225;
const DENSITY_SCALE_HEIGHT = 8500;
const GRAVITY = 9.81;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

const deg = THREE.MathUtils.degToRad;
const AIRBRAKE_AREA = 2.0;
const AERO_FEEL = {
    turnDragStrength: 0.6,
    misalignmentStrength: 2.5,
    gDragStrength: 0.4,
    alignmentRate: 2.5
};

const DEFAULT_CONTROLS = {
    pitchSpeed: deg(55),
    rollSpeed: deg(130),
    yawSpeed: deg(45),
    angularDamping: 2.0,
    pitchStability: 0.35,
    yawStability: 1.2,
    pitchInertia: 1.2,
    yawInertia: 1.5,
    rollInertia: 0.8
};

function defineAircraft(config) {
    const { controls, ...rest } = config;
    return {
        highAoADrag: 0.8,
        postStallFadeAngle: deg(15),
        crashSpeed: 15,
        ...rest,
        controls: { ...DEFAULT_CONTROLS, ...controls }
    };
}

export const AIRCRAFT_PRESETS = {
    // Add new aircraft by copying one preset and keeping values in SI units.
    cessna172: defineAircraft({
        key: 'cessna172',
        name: 'Cessna 172 Skyhawk',
        description: 'Light trainer/tourer tuned for gentle, low-speed handling.',
        mass: 1100,
        wingArea: 16.2,
        wingSpan: 10.9,
        sideArea: 5.2,
        maxThrust: 3600,
        crashSpeed: 20,
        initialAltitude: 120,
        initialSpeed: 48,
        initialPitch: deg(4),
        zeroLiftAoA: deg(-2),
        stallAoA: deg(16),
        clSlope: 5.5,
        clMax: 1.45,
        clMin: -1.1,
        parasiteDrag: 0.032,
        oswaldEfficiency: 0.8,
        sideForceSlope: 1.4
    }),
    f16: defineAircraft({
        key: 'f16',
        name: 'F-16 Fighting Falcon',
        description: 'Modern fighter-style setup with high thrust, fast cruise, and sharper controls.',
        mass: 12000,
        wingArea: 27.9,
        wingSpan: 10.0,
        sideArea: 16.0,
        maxThrust: 129000,
        initialThrottle: 0.55,
        crashSpeed: 100,
        initialAltitude: 650,
        initialSpeed: 210,
        initialPitch: deg(2),
        zeroLiftAoA: deg(-1),
        stallAoA: deg(24),
        clSlope: 3.9,
        clMax: 1.25,
        clMin: -0.9,
        parasiteDrag: 0.021,
        oswaldEfficiency: 0.62,
        sideForceSlope: 4.0,
        highAoADrag: 1.15,
        postStallFadeAngle: deg(15),
        controls: {
            pitchSpeed: deg(140),
            rollSpeed: deg(320),
            yawSpeed: deg(90),
            angularDamping: 2.6,
            pitchStability: 0.22,
            yawStability: 1.6
        }
    })
};

export const DEFAULT_AIRCRAFT_KEY = 'f16';

function getStartupAircraftKey() {
    if (typeof window === 'undefined') return DEFAULT_AIRCRAFT_KEY;
    const requestedKey = (new URLSearchParams(window.location.search).get('aircraft') || '').trim().toLowerCase();
    return AIRCRAFT_PRESETS[requestedKey] ? requestedKey : DEFAULT_AIRCRAFT_KEY;
}

let activeAircraftKey = getStartupAircraftKey();
let AIRCRAFT = AIRCRAFT_PRESETS[activeAircraftKey];
let aircraftMetrics = getAircraftMetrics(AIRCRAFT);

const angVel = new THREE.Vector3(0, 0, 0);
const forward = new THREE.Vector3();
const up = new THREE.Vector3();
const right = new THREE.Vector3();
const velDir = new THREE.Vector3();
const localVelocity = new THREE.Vector3();
const desiredVelocity = new THREE.Vector3();
const airflowError = new THREE.Vector3();
const liftDir = new THREE.Vector3();
const lateralLift = new THREE.Vector3();
const lift = new THREE.Vector3();
const drag = new THREE.Vector3();
const thrust = new THREE.Vector3();
const sideForce = new THREE.Vector3();
const weight = new THREE.Vector3();
const totalForce = new THREE.Vector3();
const inverseQuaternion = new THREE.Quaternion();
const debugArrowOrigin = new THREE.Vector3();

let debugVectorArrowsVisible = false;
let _physicsTime = 0;
let _collisionsEnabled = true;
let _crashed = false;
let _crashPos = new THREE.Vector3();
let _crashSpeed = 0;
let _crashCallbacks = [];
const debugVectorArrows = {};
const DEBUG_VECTOR_ARROW_CONFIGS = [
    { key: 'velocity', label: 'Velocity', color: 0x00e5ff, scale: 0.35, minLength: 0.2, maxLength: 35 },
    { key: 'acceleration', label: 'Acceleration', color: 0xffffff, scale: 2.0, minLength: 0.2, maxLength: 25 },
    { key: 'lift', label: 'Lift', color: 0x00ff66, scale: 0.08, sqrtScale: true, minLength: 0.2, maxLength: 35 },
    { key: 'drag', label: 'Drag', color: 0xff4444, scale: 0.08, sqrtScale: true, minLength: 0.2, maxLength: 35 },
    { key: 'thrust', label: 'Thrust', color: 0xffaa00, scale: 0.08, sqrtScale: true, minLength: 0.2, maxLength: 35 },
    { key: 'weight', label: 'Weight', color: 0x9933ff, scale: 0.08, sqrtScale: true, minLength: 0.2, maxLength: 35 },
    { key: 'sideForce', label: 'Side Force', color: 0xff66cc, scale: 0.08, sqrtScale: true, minLength: 0.2, maxLength: 35 },
    { key: 'totalForce', label: 'Total Force', color: 0xffff00, scale: 0.08, sqrtScale: true, minLength: 0.2, maxLength: 40 }
];

function getAircraftMetrics(aircraft) {
    const aspectRatio = (aircraft.wingSpan * aircraft.wingSpan) / aircraft.wingArea;
    const inducedDragFactor = 1 / (Math.PI * aspectRatio * aircraft.oswaldEfficiency);

    return {
        aspectRatio,
        inducedDragFactor
    };
}

function getAircraftConstants() {
    return {
        key: activeAircraftKey,
        name: AIRCRAFT.name,
        mass: AIRCRAFT.mass,
        wingArea: AIRCRAFT.wingArea,
        wingSpan: AIRCRAFT.wingSpan,
        aspectRatio: aircraftMetrics.aspectRatio,
        clMax: AIRCRAFT.clMax,
        stallAoA: AIRCRAFT.stallAoA,
        zeroLiftAoA: AIRCRAFT.zeroLiftAoA,
        inducedDragFactor: aircraftMetrics.inducedDragFactor,
        maxThrust: AIRCRAFT.maxThrust
    };
}

let _smoothedGForce = 1.0;

const flightState = {
    aircraft: { key: '', name: '', description: '' },
    speed: 0, throttle, aoa: 0, sideslip: 0, pitch: 0, bank: 0,
    flightPathAngle: 0, verticalSpeed: 0,
    afterburner: false,
    rho: AIR_DENSITY_SEA_LEVEL, dynamicPressure: 0,
    cl: 0, linearCl: 0, cd: 0, parasiteCd: 0, inducedCd: 0, highAoACd: 0,
    sideCoefficient: 0, lift: 0, drag: 0, thrust: 0, weight: 0, sideForce: 0,
    liftToWeight: 0, thrustToDrag: 0, stallSpeed: 0,
    localVelocity: { x: 0, y: 0, z: 0 },
    acceleration: { x: 0, y: 0, z: 0 },
    totalForce: { x: 0, y: 0, z: 0 },
    airbrakes: false, airbrakeDrag: 0,
    airflowDrag: 0, turnDrag: 0, misalignmentDrag: 0, gDrag: 0,
    formulas: { lift: '', drag: '', thrust: '', weight: '', sideForce: '', acceleration: '' },
    constants: { key: '', name: '', mass: 0, wingArea: 0, wingSpan: 0, aspectRatio: 0, clMax: 0, stallAoA: 0, zeroLiftAoA: 0, inducedDragFactor: 0, maxThrust: 0 },
    stalled: false,
    gForce: 1.0
};
syncFlightStateAircraft();

const keyboard = {};
let _suppressFlightInputs = false;
let _frozenPos = null;
let _frozenVel = null;
let _isFrozen = false;
export function setSuppressFlightInputs(v) { _suppressFlightInputs = v; }
export function setFrozen(frozen) {
    if (frozen && !_isFrozen) {
        _frozenPos = plane.position.clone();
        _frozenVel = velocity.clone();
        _isFrozen = true;
    } else if (!frozen && _isFrozen) {
        if (_frozenVel) velocity.copy(_frozenVel);
        _frozenPos = null;
        _frozenVel = null;
        _isFrozen = false;
    }
}

const cameraOffset = new THREE.Vector3(0, 5, 18);

function syncFlightStateAircraft() {
    flightState.aircraft.key = activeAircraftKey;
    flightState.aircraft.name = AIRCRAFT.name;
    flightState.aircraft.description = AIRCRAFT.description;
    flightState.constants = getAircraftConstants();
    flightState.parasiteCd = AIRCRAFT.parasiteDrag;
    flightState.weight = AIRCRAFT.mass * GRAVITY;
    plane.userData.aircraftKey = activeAircraftKey;
    plane.userData.aircraftName = AIRCRAFT.name;
}

function resetAircraftState() {
    _crashed = false;
    plane.visible = true;
    throttle = AIRCRAFT.initialThrottle ?? 1.0;
    plane.position.set(0, AIRCRAFT.initialAltitude, 0);
    const terrainY = getHeightScaled(plane.position.x, plane.position.z, 1.0);
    plane.position.y = Math.max(plane.position.y, terrainY + 20);
    plane.rotation.set(AIRCRAFT.initialPitch, 0, 0);
    velocity.set(0, 0, -AIRCRAFT.initialSpeed);
    acceleration.set(0, 0, 0);
    angVel.set(0, 0, 0);
    syncFlightStateAircraft();
}

export function getAircraftPresetList() {
    return Object.values(AIRCRAFT_PRESETS).map((aircraft) => ({
        key: aircraft.key,
        name: aircraft.name,
        description: aircraft.description
    }));
}

export function getActiveAircraftKey() {
    return activeAircraftKey;
}

export function getActiveAircraft() {
    return {
        ...AIRCRAFT,
        aspectRatio: aircraftMetrics.aspectRatio,
        inducedDragFactor: aircraftMetrics.inducedDragFactor
    };
}

export function setActiveAircraft(key, options = {}) {
    const nextAircraft = AIRCRAFT_PRESETS[key];
    if (!nextAircraft) {
        console.warn(`Unknown aircraft preset "${key}". Available presets: ${Object.keys(AIRCRAFT_PRESETS).join(', ')}`);
        return false;
    }

    activeAircraftKey = key;
    AIRCRAFT = nextAircraft;
    aircraftMetrics = getAircraftMetrics(AIRCRAFT);

    if (options.reset === false) {
        syncFlightStateAircraft();
    } else {
        resetAircraftState();
    }

    return true;
}

export function initPhysics(scene) {
    scene.add(plane);
    initDebugVectorArrows(scene);
    resetAircraftState();

    document.addEventListener('keydown', (event) => {
        keyboard[event.code] = true;
        if (event.ctrlKey || event.metaKey || ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].indexOf(event.code) > -1) {
            event.preventDefault();
        }
    });
    document.addEventListener('keyup', (event) => keyboard[event.code] = false);
}

function initDebugVectorArrows(scene) {
    DEBUG_VECTOR_ARROW_CONFIGS.forEach((config) => {
        const arrow = new THREE.ArrowHelper(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(),
            config.minLength,
            config.color,
            1.4,
            0.8
        );

        arrow.visible = debugVectorArrowsVisible;
        arrow.userData.config = config;
        arrow.line.material.depthTest = false;
        arrow.cone.material.depthTest = false;
        arrow.line.renderOrder = 1000;
        arrow.cone.renderOrder = 1000;

        debugVectorArrows[config.key] = arrow;
        scene.add(arrow);
    });
}

function getAirDensity(altitude) {
    return AIR_DENSITY_SEA_LEVEL * Math.exp(-Math.max(0, altitude) / DENSITY_SCALE_HEIGHT);
}

function getLiftCoefficient(aoa) {
    const linearCl = AIRCRAFT.clSlope * (aoa - AIRCRAFT.zeroLiftAoA);
    const absAoA = Math.abs(aoa);

    if (absAoA <= AIRCRAFT.stallAoA) {
        return {
            cl: THREE.MathUtils.clamp(linearCl, AIRCRAFT.clMin, AIRCRAFT.clMax),
            linearCl,
            stalled: false
        };
    }

    const sign = Math.sign(linearCl || aoa || 1);
    const stallCl = sign > 0 ? AIRCRAFT.clMax : AIRCRAFT.clMin;
    const stallBlend = THREE.MathUtils.clamp((absAoA - AIRCRAFT.stallAoA) / AIRCRAFT.postStallFadeAngle, 0, 1);
    const flatPlateCl = sign * 0.7 * Math.max(0, Math.sin(2 * absAoA));

    return {
        cl: THREE.MathUtils.lerp(stallCl, flatPlateCl, stallBlend),
        linearCl,
        stalled: true
    };
}

function getDragBreakdown(cl, aoa) {
    const parasiteCd = AIRCRAFT.parasiteDrag;
    const inducedCd = aircraftMetrics.inducedDragFactor * cl * cl;
    const highAoACd = AIRCRAFT.highAoADrag
        * Math.pow(Math.sin(aoa), 2)
        * (1 + 4 * Math.abs(aoa));

    return {
        parasiteCd,
        inducedCd,
        highAoACd,
        cd: parasiteCd + inducedCd + highAoACd
    };
}

function writeVector(target, source) {
    target.x = source.x;
    target.y = source.y;
    target.z = source.z;
}

function getArrowLength(vector, config) {
    const magnitude = vector.length();
    const scaledMagnitude = config.sqrtScale ? Math.sqrt(magnitude) * config.scale : magnitude * config.scale;
    return THREE.MathUtils.clamp(scaledMagnitude, config.minLength, config.maxLength);
}

function updateDebugVectorArrow(key, vector) {
    const arrow = debugVectorArrows[key];
    if (!arrow) return;

    const config = arrow.userData.config;
    if (!config || !debugVectorArrowsVisible || vector.lengthSq() < 0.000001) {
        arrow.visible = false;
        return;
    }

    arrow.visible = true;

    debugArrowOrigin.copy(plane.position);
    arrow.position.copy(debugArrowOrigin);
    arrow.setDirection(vector.clone().normalize());
    arrow.setLength(getArrowLength(vector, config), 1.4, 0.8);
}

function updateDebugVectorArrows() {
    updateDebugVectorArrow('velocity', velocity);
    updateDebugVectorArrow('acceleration', acceleration);
    updateDebugVectorArrow('lift', lift);
    updateDebugVectorArrow('drag', drag);
    updateDebugVectorArrow('thrust', thrust);
    updateDebugVectorArrow('weight', weight);
    updateDebugVectorArrow('sideForce', sideForce);
    updateDebugVectorArrow('totalForce', totalForce);

}

export function setDebugVectorsVisible(visible) {
    debugVectorArrowsVisible = visible;
    Object.values(debugVectorArrows).forEach((arrow) => {
        arrow.visible = visible;
    });
}

export function getDebugVectorLegend() {
    return DEBUG_VECTOR_ARROW_CONFIGS.map((config) => ({
        key: config.key,
        label: config.label,
        color: `#${config.color.toString(16).padStart(6, '0')}`
    }));
}

export function getPhysicsStats() {
    return { physicsTime: _physicsTime };
}

export function setThrottle(v) { throttle = THREE.MathUtils.clamp(v, 0, 1); }
export function getCollisionsEnabled() { return _collisionsEnabled; }
export function setCollisionsEnabled(v) { _collisionsEnabled = v; }
export function isCrashed() { return _crashed; }
export function getCrashInfo() { return { pos: _crashPos, speed: _crashSpeed }; }
export function onCrash(fn) { _crashCallbacks.push(fn); }
export function resetAircraft() {
    _crashed = false;
    plane.visible = true;
    resetAircraftState();
}

export function updatePlane(dt) {
    if (_crashed) { _physicsTime = 0; return; }
    const _start = performance.now();
    const pitchInput = _suppressFlightInputs ? 0 : (keyboard['KeyW'] ? 1 : 0) + (keyboard['KeyS'] ? -1 : 0);
    const rollInput  = _suppressFlightInputs ? 0 : (keyboard['KeyA'] ? 1 : 0) + (keyboard['KeyD'] ? -1 : 0);
    const yawInput   = _suppressFlightInputs ? 0 : (keyboard['KeyQ'] ? 1 : 0) + (keyboard['KeyE'] ? -1 : 0);
    const throttleInput = _suppressFlightInputs ? 0 : (keyboard['ArrowUp'] ? 1 : 0) + (keyboard['ArrowDown'] ? -1 : 0);
    const controls = AIRCRAFT.controls;

    throttle = THREE.MathUtils.clamp(throttle + throttleInput * 3.0 * dt, 0, 1);

    forward.set(0, 0, -1).applyQuaternion(plane.quaternion).normalize();
    up.set(0, 1, 0).applyQuaternion(plane.quaternion).normalize();
    right.set(1, 0, 0).applyQuaternion(plane.quaternion).normalize();

    const speed = velocity.length();
    if (speed > 0.001) {
        velDir.copy(velocity).normalize();
    } else {
        velDir.copy(forward);
    }

    const rho = getAirDensity(plane.position.y);
    const dynamicPressure = 0.5 * rho * speed * speed;

    inverseQuaternion.copy(plane.quaternion).invert();
    localVelocity.copy(velocity).applyQuaternion(inverseQuaternion);

    let forwardSpeed = -localVelocity.z;
    let aoa = Math.atan2(-localVelocity.y, forwardSpeed);
    let sideslip = Math.atan2(localVelocity.x, Math.max(0.001, forwardSpeed));

    const authority = THREE.MathUtils.clamp(dynamicPressure / 5000, 0.15, 1.0);

    let desiredPitch = pitchInput * controls.pitchSpeed * authority;
    let desiredRoll  = rollInput  * controls.rollSpeed * authority;
    let desiredYaw   = yawInput   * controls.yawSpeed * authority;

    const angBlend = 8;
    const pitchBlend = Math.min(1, angBlend * dt / Math.max(0.001, controls.pitchInertia));
    const yawBlend = Math.min(1, angBlend * dt / Math.max(0.001, controls.yawInertia));
    const rollBlend = Math.min(1, angBlend * dt / Math.max(0.001, controls.rollInertia));

    angVel.x += (desiredPitch - angVel.x) * pitchBlend;
    angVel.y += (desiredYaw   - angVel.y) * yawBlend;
    angVel.z += (desiredRoll  - angVel.z) * rollBlend;

    if (speed > 5) {
        if (pitchInput === 0) angVel.x += -aoa * controls.pitchStability * dt;
        if (yawInput === 0) angVel.y += -sideslip * controls.yawStability * dt;

        airflowError.copy(velDir).cross(forward).applyQuaternion(inverseQuaternion);
        angVel.x -= airflowError.x * 0.15 * dt;
        angVel.y -= airflowError.y * 0.3 * dt;
        angVel.z -= airflowError.z * 0.1 * dt;
    }

    const q = dynamicPressure;
    const pitchDamping = q * 0.000001;
    const yawDamping = q * 0.0000015;
    const rollDamping = q * 0.000002;

    angVel.x *= Math.max(0, 1 - pitchDamping * dt);
    angVel.y *= Math.max(0, 1 - yawDamping * dt);
    angVel.z *= Math.max(0, 1 - rollDamping * dt);
    angVel.multiplyScalar(Math.max(0, 1 - controls.angularDamping * dt));

    plane.rotateX(angVel.x * dt);
    plane.rotateY(angVel.y * dt);
    plane.rotateZ(angVel.z * dt);

    forward.set(0, 0, -1).applyQuaternion(plane.quaternion).normalize();
    up.set(0, 1, 0).applyQuaternion(plane.quaternion).normalize();
    right.set(1, 0, 0).applyQuaternion(plane.quaternion).normalize();

    inverseQuaternion.copy(plane.quaternion).invert();
    localVelocity.copy(velocity).applyQuaternion(inverseQuaternion);

    forwardSpeed = -localVelocity.z;
    aoa = Math.atan2(-localVelocity.y, forwardSpeed);
    sideslip = Math.atan2(localVelocity.x, Math.max(0.001, forwardSpeed));

    const liftCoefficient = getLiftCoefficient(aoa);
    const dragBreakdown = getDragBreakdown(liftCoefficient.cl, aoa);
    const liftForce = dynamicPressure * AIRCRAFT.wingArea * liftCoefficient.cl;
    const dragForce = dynamicPressure * AIRCRAFT.wingArea * dragBreakdown.cd;
    const airbrakeOn = keyboard['Space'];
    const airbrakeDrag = airbrakeOn ? dynamicPressure * AIRBRAKE_AREA * 1.0 : 0;
    const _milPower = 76000;
    const _abMult = 1.7;
    const _abThresh = 0.85;
    let thrustForce;
    if (throttle <= _abThresh) {
        thrustForce = (throttle / _abThresh) * _milPower;
    } else {
        const abFrac = (throttle - _abThresh) / (1 - _abThresh);
        thrustForce = _milPower + abFrac * (_milPower * (_abMult - 1));
    }
    const weightForce = AIRCRAFT.mass * GRAVITY;
    const sideCoefficient = THREE.MathUtils.clamp(-AIRCRAFT.sideForceSlope * sideslip, -1.5, 1.5);
    const sideForceMag = dynamicPressure * AIRCRAFT.sideArea * sideCoefficient;

    liftDir.copy(up).projectOnPlane(velDir);
    if (liftDir.lengthSq() > 0.000001) {
        liftDir.normalize();
    } else {
        liftDir.copy(up);
    }

    lift.copy(liftDir).multiplyScalar(liftForce);
    drag.copy(velDir).multiplyScalar(-(dragForce + airbrakeDrag));

    const loadFactor = Math.abs(liftForce) / (AIRCRAFT.mass * GRAVITY);
    const inducedTurnDrag = Math.max(0, loadFactor - 1) * dynamicPressure * 0.015;
    const airflowDrag = inducedTurnDrag;
    const turnDrag = inducedTurnDrag;
    const misalignmentDrag = 0;
    const gDrag = 0;
    drag.addScaledVector(velDir, -airflowDrag);

    thrust.copy(forward).multiplyScalar(thrustForce);
    sideForce.copy(right).multiplyScalar(sideForceMag);
    weight.set(0, -weightForce, 0);

    totalForce.set(0, 0, 0);
    totalForce.add(lift);
    totalForce.add(drag);
    totalForce.add(thrust);
    totalForce.add(sideForce);
    totalForce.add(weight);
    acceleration.copy(totalForce).divideScalar(AIRCRAFT.mass);

    velocity.addScaledVector(acceleration, dt);
    const velBeforeAlign = velocity.clone();
    const postAccelerationSpeed = velocity.length();
    if (postAccelerationSpeed > 0.001) {
        desiredVelocity.copy(forward).multiplyScalar(postAccelerationSpeed);
        const absAoA = Math.abs(aoa);
        const stallDepth = absAoA > AIRCRAFT.stallAoA
            ? THREE.MathUtils.clamp((absAoA - AIRCRAFT.stallAoA) / AIRCRAFT.postStallFadeAngle, 0, 1)
            : 0;
        const effectiveRate = AERO_FEEL.alignmentRate * (1 - stallDepth);
        velocity.lerp(desiredVelocity, Math.min(1, dt * effectiveRate));
    }
    // G-force must reflect total acceleration (forces + alignment), not just forces
    acceleration.copy(velocity).sub(velBeforeAlign).divideScalar(dt);
    plane.position.addScaledVector(velocity, dt);

    if (!_crashed) {
        const impactSpeed = velocity.length();
        const terrainY = getHeightScaled(plane.position.x, plane.position.z, 1.0);
        if (plane.position.y < terrainY) {
            if (_collisionsEnabled) {
                const craftPitch = Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1));
                const craftBank = Math.atan2(right.y, up.y);
                const isLevel = Math.abs(craftPitch) <= deg(15) && Math.abs(craftBank) <= deg(15);
                const hardDesc = velocity.y < -8;
                const overspeed = impactSpeed >= AIRCRAFT.crashSpeed;
                if (!isLevel || hardDesc || overspeed) {
                    _crashed = true;
                    _crashPos.copy(plane.position);
                    _crashSpeed = impactSpeed;
                    plane.visible = false;
                    for (const fn of _crashCallbacks) fn(_crashPos.clone(), _crashSpeed);
                } else {
                    plane.position.y = terrainY;
                    if (velocity.y < 0) velocity.y = 0;
                }
            } else {
                plane.position.y = terrainY;
                if (velocity.y < 0) velocity.y = 0;
            }
        } else if (plane.position.y < 2) {
            plane.position.y = 2;
            if (velocity.y < 0) velocity.y = 0;
        }
    }

    const _pitch = Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1));
    const _bank = Math.atan2(right.y, up.y);
    flightState.pitchOk = Math.abs(_pitch) <= deg(25);
    flightState.bankOk = Math.abs(_bank) <= deg(25);
    flightState.descOk = velocity.y >= -30;
    flightState.speedOk = speed < AIRCRAFT.crashSpeed;
    flightState.canLand = !_crashed && flightState.pitchOk && flightState.bankOk && flightState.descOk && flightState.speedOk;

    flightState.speed = speed;
    flightState.throttle = throttle;
    flightState.afterburner = throttle > _abThresh;
    flightState.aoa = aoa;
    flightState.sideslip = sideslip;
    flightState.pitch = Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1));
    flightState.bank = Math.atan2(right.y, up.y);
    flightState.flightPathAngle = speed > 0.001 ? Math.asin(THREE.MathUtils.clamp(velocity.y / speed, -1, 1)) : 0;
    flightState.verticalSpeed = velocity.y;
    flightState.rho = rho;
    flightState.dynamicPressure = dynamicPressure;
    flightState.cl = liftCoefficient.cl;
    flightState.linearCl = liftCoefficient.linearCl;
    flightState.cd = dragBreakdown.cd;
    flightState.parasiteCd = dragBreakdown.parasiteCd;
    flightState.inducedCd = dragBreakdown.inducedCd;
    flightState.highAoACd = dragBreakdown.highAoACd;
    flightState.sideCoefficient = sideCoefficient;
    flightState.lift = liftForce;
    flightState.drag = dragForce + airbrakeDrag + airflowDrag;
    flightState.thrust = thrustForce;
    flightState.weight = weightForce;
    flightState.sideForce = sideForceMag;
    flightState.liftToWeight = weightForce > 0 ? liftForce / weightForce : 0;
    flightState.thrustToDrag = flightState.drag > 0 ? thrustForce / flightState.drag : 0;
    flightState.stallSpeed = Math.sqrt((2 * weightForce) / (rho * AIRCRAFT.wingArea * AIRCRAFT.clMax));
    flightState.stalled = liftCoefficient.stalled;
    flightState.airbrakes = airbrakeOn;
    flightState.airbrakeDrag = airbrakeDrag;
    flightState.airflowDrag = airflowDrag;
    flightState.turnDrag = turnDrag;
    flightState.misalignmentDrag = misalignmentDrag;
    flightState.gDrag = gDrag;
    writeVector(flightState.localVelocity, localVelocity);
    writeVector(flightState.acceleration, acceleration);
    writeVector(flightState.totalForce, totalForce);
    flightState.formulas.lift = `L = q*S*CL = ${dynamicPressure.toFixed(1)}*${AIRCRAFT.wingArea.toFixed(1)}*${liftCoefficient.cl.toFixed(3)} = ${liftForce.toFixed(1)} N`;
    flightState.formulas.drag = `D = q*S*CD = ${dynamicPressure.toFixed(1)}*${AIRCRAFT.wingArea.toFixed(1)}*${dragBreakdown.cd.toFixed(3)} = ${dragForce.toFixed(1)} N${airbrakeOn ? ` + airbrake ${airbrakeDrag.toFixed(1)} N` : ''}${airflowDrag > 0 ? ` + airflow ${airflowDrag.toFixed(1)} N (turn ${turnDrag.toFixed(1)}, align ${misalignmentDrag.toFixed(1)}, G ${gDrag.toFixed(1)})` : ''}`;
    flightState.formulas.thrust = `T = ${throttle > _abThresh ? 'AB+' : ''}${thrustForce.toFixed(0)} N (mil ${(_milPower/1000).toFixed(0)}kN × ${throttle > _abThresh ? `AB ${((_milPower*(_abMult-1))/1000).toFixed(0)}kN` : (throttle/_abThresh).toFixed(2)})`;
    flightState.formulas.weight = `W = m*g = ${AIRCRAFT.mass.toFixed(0)}*${GRAVITY.toFixed(2)} = ${weightForce.toFixed(1)} N`;
    flightState.formulas.sideForce = `Y = q*Sside*CY = ${dynamicPressure.toFixed(1)}*${AIRCRAFT.sideArea.toFixed(1)}*${sideCoefficient.toFixed(3)} = ${sideForceMag.toFixed(1)} N`;
    flightState.formulas.acceleration = `a_total = F/m + alignment = (${totalForce.x.toFixed(1)}, ${totalForce.y.toFixed(1)}, ${totalForce.z.toFixed(1)})/${AIRCRAFT.mass.toFixed(0)} → (${acceleration.x.toFixed(2)}, ${acceleration.y.toFixed(2)}, ${acceleration.z.toFixed(2)}) m/s^2`;
    const rawG = acceleration.length() / GRAVITY + 1.0;
    _smoothedGForce += (rawG - _smoothedGForce) * Math.min(1, dt * 8);
    flightState.gForce = _smoothedGForce;
    if (_isFrozen && _frozenPos) {
        plane.position.copy(_frozenPos);
        velocity.set(0, 0, 0);
    }
    _physicsTime = performance.now() - _start;
    updateDebugVectorArrows();
}

export function updateCamera(camera) {
    const worldOffset = cameraOffset.clone().applyQuaternion(plane.quaternion);
    camera.position.copy(plane.position).add(worldOffset);
    camera.quaternion.copy(plane.quaternion);
}

export function getPlane() {
    return plane;
}

export function getFlightState() {
    return flightState;
}
