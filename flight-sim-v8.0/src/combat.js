import * as THREE from 'three';
import { getHeightScaled } from './terrain.js';

const MAX_CRATERS = 64;
const craters = [];
const _craterVec4 = [];
const MISSILE_SPEED = 400;
const MISSILE_LIFETIME = 8;
const BULLET_SPEED = 1050;
const BULLET_LIFETIME = 2.5;
const CONTINUOUS_FIRE_INTERVAL = 0.066;
const EXPLOSION_PARTICLES = 250;
const EXPLOSION_DURATION = 800;
const SMOKE_PARTICLES = 150;
const SMOKE_DURATION = 1500;
const BULLET_HIT_RADIUS = 3;
const MISSILE_HIT_RADIUS = 6;
const LOCK_RANGE = 1200;
const PLAYER_LOCK_CONE = 0.26;
const ENEMY_LOCK_CONE = 0.52;
const SOFT_LOCK_TIME = 1.5;
const HARD_LOCK_TIME = 3.0;
const _v3 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);
const _tv1 = new THREE.Vector3();
const _tv2 = new THREE.Vector3();
const _enemyDir = new THREE.Vector3();
const _bulletMid = new THREE.Vector3();
let _nextEnemyId = 0;

let playerHealth = 100;
const MAX_PLAYER_HEALTH = 100;
let _hitThisFrame = false;
let _killThisFrame = false;

let _playerLockTargetId = null;
let _playerLockTimer = 0;
let _playerLockState = 'none';

let _onEnemyKill = null;

export function onEnemyKill(cb) { _onEnemyKill = cb; }

let _scene = null;
let _group = null;
let _explosions = [];
let _missiles = [];
let _bullets = [];
let _enemies = [];

export function getMaxCraters() { return MAX_CRATERS; }

export function explode(pos, radius, depth) {
    const terrainY = getHeightScaled(pos.x, pos.z, 1.0);
    const h = pos.y - terrainY;
    if (h > radius * 2) return;
    craters.push({ x: pos.x, z: pos.z, radius, depth });
    if (craters.length > MAX_CRATERS) craters.splice(0, craters.length - MAX_CRATERS);
}

export function getCraterArray() {
    _craterVec4.length = 0;
    for (let i = 0; i < MAX_CRATERS; i++) {
        const c = craters[i];
        _craterVec4.push(c ? c.x : 0, c ? c.z : 0, c ? c.radius : 1, c ? c.depth : 0);
    }
    return _craterVec4;
}

export function getCraterCount() { return craters.length; }

export function init(scene) {
    _scene = scene;
    _group = new THREE.Group();
    scene.add(_group);
}

function spawnExplosion(pos, speed) {
    const count = EXPLOSION_PARTICLES;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = [];
    const spread = 20 + speed * 0.3;
    for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        positions[i3] = pos.x + (Math.random() - 0.5) * 4;
        positions[i3 + 1] = pos.y + (Math.random() - 0.5) * 4;
        positions[i3 + 2] = pos.z + (Math.random() - 0.5) * 4;
        const b = 0.5 + Math.random() * 0.5;
        colors[i3] = 1;
        colors[i3 + 1] = 0.4 + Math.random() * 0.3;
        colors[i3 + 2] = 0;
        velocities.push(new THREE.Vector3(
            (Math.random() - 0.5) * spread,
            Math.random() * spread * 0.8,
            (Math.random() - 0.5) * spread
        ));
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
        size: 5 + speed * 0.03,
        vertexColors: true,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const mesh = new THREE.Points(geom, mat);
    mesh.userData.velocities = velocities;
    mesh.userData.start = performance.now();
    _group.add(mesh);
    _explosions.push(mesh);

    const smokeCount = SMOKE_PARTICLES;
    const smokePos = new Float32Array(smokeCount * 3);
    const smokeCol = new Float32Array(smokeCount * 3);
    const smokeVel = [];
    const smokeSpread = 10 + speed * 0.2;
    for (let i = 0; i < smokeCount; i++) {
        const i3 = i * 3;
        smokePos[i3] = pos.x + (Math.random() - 0.5) * 6;
        smokePos[i3 + 1] = pos.y + (Math.random() - 0.5) * 2;
        smokePos[i3 + 2] = pos.z + (Math.random() - 0.5) * 6;
        const gray = 0.4 + Math.random() * 0.4;
        smokeCol[i3] = gray;
        smokeCol[i3 + 1] = gray;
        smokeCol[i3 + 2] = gray;
        smokeVel.push(new THREE.Vector3(
            (Math.random() - 0.5) * smokeSpread * 0.5,
            Math.random() * smokeSpread * 0.6 + 5,
            (Math.random() - 0.5) * smokeSpread * 0.5
        ));
    }
    const smokeGeom = new THREE.BufferGeometry();
    smokeGeom.setAttribute('position', new THREE.BufferAttribute(smokePos, 3));
    smokeGeom.setAttribute('color', new THREE.BufferAttribute(smokeCol, 3));
    const smokeMat = new THREE.PointsMaterial({
        size: 8 + speed * 0.05,
        vertexColors: true,
        transparent: true,
        opacity: 0.5,
        blending: THREE.NormalBlending,
        depthWrite: false
    });
    const smokeMesh = new THREE.Points(smokeGeom, smokeMat);
    smokeMesh.userData.velocities = smokeVel;
    smokeMesh.userData.start = performance.now();
    smokeMesh.userData.isSmoke = true;
    _group.add(smokeMesh);
    _explosions.push(smokeMesh);
}

function spawnHitParticles(pos) {
    const count = 30;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = [];
    const spread = 8;
    for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        positions[i3] = pos.x + (Math.random() - 0.5) * 2;
        positions[i3 + 1] = pos.y + (Math.random() - 0.5) * 2;
        positions[i3 + 2] = pos.z + (Math.random() - 0.5) * 2;
        colors[i3] = 1;
        colors[i3 + 1] = 0.8 + Math.random() * 0.2;
        colors[i3 + 2] = 0.2;
        velocities.push(new THREE.Vector3(
            (Math.random() - 0.5) * spread,
            Math.random() * spread * 0.5,
            (Math.random() - 0.5) * spread
        ));
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
        size: 2.5,
        vertexColors: true,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const mesh = new THREE.Points(geom, mat);
    mesh.userData.velocities = velocities;
    mesh.userData.start = performance.now();
    mesh.userData.hitParticles = true;
    _group.add(mesh);
    _explosions.push(mesh);
}

export function getPlayerHealth() { return playerHealth; }
export function getMaxPlayerHealth() { return MAX_PLAYER_HEALTH; }
export function getHitThisFrame() { return _hitThisFrame; }
export function getKillThisFrame() { return _killThisFrame; }
export function resetPlayer() {
    playerHealth = MAX_PLAYER_HEALTH;
    _playerLockTargetId = null;
    _playerLockTimer = 0;
    _playerLockState = 'none';
}

export function clearProjectiles() {
    if (_group) {
        for (const m of _missiles) {
            _group.remove(m.mesh);
        }
        for (const b of _bullets) {
            _group.remove(b.mesh);
        }
        for (const e of _explosions) {
            _group.remove(e);
            e.geometry.dispose();
            e.material.dispose();
        }
    }
    _missiles = [];
    _bullets = [];
    _explosions = [];
}


export function getLockWarnings() {
    const warnings = [];
    for (const e of _enemies) {
        if (e.lockState === 'soft' || e.lockState === 'hard') {
            warnings.push({
                type: e.lockState,
                bearing: e._lockBearing || 0,
                id: e.id
            });
        }
    }
    return warnings;
}

export function isPlayerLocked() { return _playerLockState !== 'none'; }
export function getPlayerLockState() { return _playerLockState; }
export function getPlayerLockTargetId() { return _playerLockTargetId; }
export function getPlayerLockTimer() { return _playerLockTimer; }
export function getPlayerLockProgress() {
    if (_playerLockState === 'hard') return 1;
    if (_playerLockState === 'soft') return (_playerLockTimer - SOFT_LOCK_TIME) / (HARD_LOCK_TIME - SOFT_LOCK_TIME);
    return _playerLockTimer / SOFT_LOCK_TIME;
}

export function setPlayerLockTarget(targetId) {
    if (targetId === null || targetId === undefined) {
        _playerLockTargetId = null;
        _playerLockTimer = 0;
        _playerLockState = 'none';
        return;
    }
    _playerLockTargetId = targetId;
}

export function findLockTarget(playerPos, playerQuat) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(playerQuat);
    let nearest = null;
    let nearestDist = Infinity;
    for (const e of _enemies) {
        _tv1.copy(e.mesh.position).sub(playerPos);
        const dist = _tv1.length();
        if (dist > LOCK_RANGE) continue;
        const angle = Math.acos(Math.max(-1, Math.min(1, _tv1.dot(fwd) / dist)));
        if (angle > PLAYER_LOCK_CONE) continue;
        if (dist < nearestDist) {
            nearestDist = dist;
            nearest = e;
        }
    }
    return nearest ? nearest.id : null;
}

const _missileGeom = new THREE.ConeGeometry(0.8, 3, 6);
const _missileMat = new THREE.MeshBasicMaterial({ color: 0x888888 });

export function fireMissile(origin, direction, quaternion, target, lockType) {
    const mesh = new THREE.Mesh(_missileGeom, _missileMat);
    mesh.position.copy(origin);
    mesh.quaternion.copy(quaternion || new THREE.Quaternion());
    _group.add(mesh);
    _missiles.push({
        mesh,
        dir: direction.clone().normalize(),
        life: 0,
        target: target || null,
        lockType: lockType || 'none'
    });
}

const _tracerGeom = new THREE.BoxGeometry(0.15, 0.15, 1.0);
const _tracerMat = new THREE.MeshBasicMaterial({
    color: 0xffdd00,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false
});
const STREAK_LEN = 35;
let _vHeld = false;
let _vFireTimer = 0;

export function setTriggerHeld(held) { _vHeld = held; }

function fireMachineGun(origin, direction) {
    const mesh = new THREE.Mesh(_tracerGeom, _tracerMat);
    mesh.position.copy(origin);
    _group.add(mesh);
    _bullets.push({
        mesh,
        dir: direction.clone().normalize(),
        life: 0,
        tipPos: origin.clone()
    });
}

const _enemyGeom = new THREE.BoxGeometry(4, 1, 8);
const _enemyMat = new THREE.MeshStandardMaterial({ color: 0xff3333, metalness: 0.2, roughness: 0.6 });
const _enemyTrailLen = 40;
const ENEMY_MAX_HP = 100;

export function updateAutoFire(dt, origin, dir) {
    if (!_vHeld) { _vFireTimer = CONTINUOUS_FIRE_INTERVAL; return; }
    _vFireTimer -= dt;
    if (_vFireTimer <= 0) {
        _vFireTimer = CONTINUOUS_FIRE_INTERVAL;
        _v3.copy(dir);
        _v3.x += (Math.random() - 0.5) * 0.015;
        _v3.y += (Math.random() - 0.5) * 0.015;
        _v3.z += (Math.random() - 0.5) * 0.005;
        _v3.normalize();
        fireMachineGun(origin, _v3);
    }
}

export function spawnEnemy(position, heading) {
    const mesh = new THREE.Mesh(_enemyGeom, _enemyMat);
    mesh.position.copy(position);
    mesh.rotation.y = heading;
    _group.add(mesh);

    const trailPos = new Float32Array(_enemyTrailLen * 3);
    const trailGeom = new THREE.BufferGeometry();
    trailGeom.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    trailGeom.setDrawRange(0, 0);
    const trailMat = new THREE.LineBasicMaterial({
        color: 0xff6666, transparent: true, opacity: 0.3
    });
    const trailLine = new THREE.Line(trailGeom, trailMat);
    trailLine.frustumCulled = false;
    _group.add(trailLine);

    _enemies.push({
        mesh, trail: { line: trailLine, pos: trailPos, count: 0, head: 0 },
        heading, speed: 150 + Math.random() * 80, id: _nextEnemyId++,
        hp: ENEMY_MAX_HP,
        lockTimer: 0,
        lockState: 'none',
        _lockBearing: 0,
        _aiFireCooldown: 0
    });
}

export function getEnemyData() {
    return _enemies.map(e => ({
        id: e.id,
        x: e.mesh.position.x,
        y: e.mesh.position.y,
        z: e.mesh.position.z,
        hp: e.hp,
        maxHp: ENEMY_MAX_HP,
        lockState: e.lockState
    }));
}

export function getProjectilePositions() {
    const out = [];
    for (const m of _missiles) out.push(m.mesh.position.clone());
    for (const b of _bullets) out.push(b.tipPos.clone());
    return out;
}

export function getMissileCount() { return _missiles.length; }
export function getBulletCount() { return _bullets.length; }
export function getEnemyCount() { return _enemies.length; }

export function getEnemyHealth(id) {
    const e = _enemies.find(x => x.id === id);
    return e ? e.hp : 0;
}

export function getLeadPoint(enemyId, playerPos) {
    const e = _enemies.find(x => x.id === enemyId);
    if (!e || !playerPos) return null;
    const ep = e.mesh.position;
    _tv1.copy(ep).sub(playerPos);
    const dist = _tv1.length();
    if (dist < 250) return null;

    _enemyDir.set(0, 0, -1).applyAxisAngle(_up, e.heading);
    const vel = _tv2.set(_enemyDir.x * e.speed, 0, _enemyDir.z * e.speed);
    const terrainY = getHeightScaled(ep.x, ep.z, 1.0);
    const targetAlt = terrainY + 200 + Math.sin(performance.now() * 0.0007 + e.id * 3) * 40;
    vel.y = (targetAlt - ep.y) * 2;

    const a = vel.dot(vel) - BULLET_SPEED * BULLET_SPEED;
    const b = 2 * _tv1.dot(vel);
    const c = _tv1.dot(_tv1);

    if (Math.abs(a) < 0.0001) {
        if (Math.abs(b) < 0.0001) return null;
        const t = -c / b;
        if (t < 0 || t > 3) return null;
        return _v3.copy(ep).addScaledVector(vel, t);
    }

    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;

    const sqrtDisc = Math.sqrt(disc);
    let t1 = (-b + sqrtDisc) / (2 * a);
    let t2 = (-b - sqrtDisc) / (2 * a);
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    const t = t1 >= 0 ? t1 : t2;
    if (t < 0 || t > 3) return null;

    return _v3.copy(ep).addScaledVector(vel, t);
}

export function update(dt, playerPos, playerQuat) {
    const now = performance.now();
    _hitThisFrame = false;
    _killThisFrame = false;

    // Missiles
    for (let i = _missiles.length - 1; i >= 0; i--) {
        const m = _missiles[i];
        m.life += dt;

        if (m.target && m.lockType !== 'none') {
            if (m.target.enemyId !== undefined) {
                const te = _enemies.find(e => e.id === m.target.enemyId);
                if (te) {
                    _tv1.copy(te.mesh.position).sub(m.mesh.position);
                } else {
                    _tv1.copy(m.dir).multiplyScalar(1000);
                }
            } else {
                _tv1.copy(m.target).sub(m.mesh.position);
            }
            const dist = _tv1.length();
            if (dist > 1) {
                _tv1.normalize();
                const turnRate = m.lockType === 'hard' ? 1.5 : 0.5;
                const dot = m.dir.dot(_tv1);
                if (dot < 0.999) {
                    _tv2.crossVectors(m.dir, _tv1);
                    if (_tv2.lengthSq() < 0.0001) {
                        _tv2.set(0, 1, 0);
                        _tv2.crossVectors(m.dir, _tv2);
                        if (_tv2.lengthSq() < 0.0001) {
                            _tv2.set(1, 0, 0);
                            _tv2.crossVectors(m.dir, _tv2);
                        }
                    }
                    _tv2.normalize();
                    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
                    const maxTurn = turnRate * dt;
                    m.dir.applyAxisAngle(_tv2, Math.min(angle, maxTurn)).normalize();
                    m.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), m.dir);
                }
            }
        }

        m.mesh.position.addScaledVector(m.dir, MISSILE_SPEED * dt);

        // Missile vs enemies
        let removed = false;
        for (let ei = _enemies.length - 1; ei >= 0; ei--) {
            const e = _enemies[ei];
            _tv1.copy(m.mesh.position).sub(e.mesh.position);
            if (_tv1.lengthSq() < MISSILE_HIT_RADIUS * MISSILE_HIT_RADIUS) {
                e.hp -= 75;
                spawnExplosion(m.mesh.position, 100);
                _group.remove(m.mesh);
                _missiles.splice(i, 1);
                removed = true;
                if (m.target && m.target.enemyId !== undefined) {
                    _hitThisFrame = true;
                }
                if (e.hp <= 0) {
                    _killThisFrame = true;
                    spawnExplosion(e.mesh.position, 150);
                    _group.remove(e.mesh);
                    _group.remove(e.trail.line);
                    e.trail.line.geometry.dispose();
                    e.trail.line.material.dispose();
                    if (_onEnemyKill) _onEnemyKill(e.id, e.mesh.position.clone());
                    _enemies.splice(ei, 1);
                }
                break;
            }
        }
        if (removed) continue;

        // Missile vs player
        if (playerPos) {
            _tv1.copy(m.mesh.position).sub(playerPos);
            if (_tv1.lengthSq() < MISSILE_HIT_RADIUS * MISSILE_HIT_RADIUS) {
                playerHealth = Math.max(0, playerHealth - 50);
                spawnExplosion(m.mesh.position, 100);
                _group.remove(m.mesh);
                _missiles.splice(i, 1);
                continue;
            }
        }

        const terrainY = getHeightScaled(m.mesh.position.x, m.mesh.position.z, 1.0);
        if (m.mesh.position.y < terrainY || m.life > MISSILE_LIFETIME) {
            if (m.mesh.position.y < terrainY) {
                explode(m.mesh.position, 40, 20);
                spawnExplosion(m.mesh.position, 100);
            }
            _group.remove(m.mesh);
            _missiles.splice(i, 1);
        }
    }

    // Bullets (tracer streaks)
    for (let i = _bullets.length - 1; i >= 0; i--) {
        const b = _bullets[i];
        b.life += dt;
        b.tipPos.addScaledVector(b.dir, BULLET_SPEED * dt);

        const trailLen = Math.min(STREAK_LEN, b.life * BULLET_SPEED);
        _bulletMid.copy(b.tipPos).addScaledVector(b.dir, -trailLen * 0.5);
        b.mesh.position.copy(_bulletMid);
        b.mesh.scale.z = trailLen;
        b.mesh.quaternion.setFromUnitVectors(_zAxis, b.dir);

        let removed = false;
        for (let ei = _enemies.length - 1; ei >= 0; ei--) {
            const e = _enemies[ei];
            _tv1.copy(b.tipPos).sub(e.mesh.position);
            if (_tv1.lengthSq() < BULLET_HIT_RADIUS * BULLET_HIT_RADIUS) {
                e.hp -= 15;
                spawnHitParticles(b.tipPos);
                _hitThisFrame = true;
                _group.remove(b.mesh);
                _bullets.splice(i, 1);
                removed = true;
                if (e.hp <= 0) {
                    _killThisFrame = true;
                    spawnExplosion(e.mesh.position, 150);
                    _group.remove(e.mesh);
                    _group.remove(e.trail.line);
                    e.trail.line.geometry.dispose();
                    e.trail.line.material.dispose();
                    if (_onEnemyKill) _onEnemyKill(e.id, e.mesh.position.clone());
                    _enemies.splice(ei, 1);
                }
                break;
            }
        }
        if (removed) continue;

        const terrainY = getHeightScaled(b.tipPos.x, b.tipPos.z, 1.0);
        if (b.tipPos.y < terrainY || b.life > BULLET_LIFETIME) {
            _group.remove(b.mesh);
            _bullets.splice(i, 1);
        }
    }

    // Enemies + their trails
    for (const e of _enemies) {
        const time = now * 0.001;
        _enemyDir.set(0, 0, -1).applyAxisAngle(_up, e.heading);

        const terrainY = getHeightScaled(e.mesh.position.x, e.mesh.position.z, 1.0);
        const targetAlt = terrainY + 200 + Math.sin(time * 0.7 + e.id * 3) * 40;
        const altDiff = targetAlt - e.mesh.position.y;
        e.mesh.position.y += altDiff * dt * 2;

        e.mesh.position.addScaledVector(_enemyDir, e.speed * dt);

        let headingChange = Math.sin(time * 0.4 + e.id * 3) * 0.3;
        let relAngle = 0;
        const playerAhead = playerPos && (() => {
            const dx = playerPos.x - e.mesh.position.x;
            const dz = playerPos.z - e.mesh.position.z;
            const bearing = Math.atan2(dx, -dz);
            const fwdAngle = Math.atan2(_enemyDir.x, -_enemyDir.z);
            relAngle = bearing - fwdAngle;
            while (relAngle > Math.PI) relAngle -= Math.PI * 2;
            while (relAngle < -Math.PI) relAngle += Math.PI * 2;
            e._lockBearing = bearing;
            if (Math.abs(relAngle) < 0.8) {
                const focus = 1 - Math.abs(relAngle) / 0.8;
                const pursuitTurn = -relAngle * 0.6;
                headingChange = headingChange * (1 - focus * 0.85) + pursuitTurn * focus * 0.85;
            }
            return true;
        })();
        e.heading += headingChange * dt;
        const pitch = Math.sin(time * 0.5 + e.id * 2) * 0.12;
        const roll = Math.sin(time * 0.6 + e.id * 4) * 0.08;
        e.mesh.quaternion.setFromEuler(new THREE.Euler(pitch, e.heading, roll));

        // Enemy lock on player
        if (playerAhead) {
            _tv1.copy(playerPos).sub(e.mesh.position);
            const dist = _tv1.length();

            if (dist < LOCK_RANGE && Math.abs(relAngle) < ENEMY_LOCK_CONE) {
                e.lockTimer += dt;
                if (e.lockTimer >= HARD_LOCK_TIME) {
                    e.lockState = 'hard';
                } else if (e.lockTimer >= SOFT_LOCK_TIME) {
                    e.lockState = 'soft';
                }
            } else {
                e.lockTimer = Math.max(0, e.lockTimer - dt * 2);
                if (e.lockTimer < SOFT_LOCK_TIME) e.lockState = 'none';
            }

            // Enemy AI fire missiles
            e._aiFireCooldown -= dt;
            if (e.lockState === 'hard' && e._aiFireCooldown <= 0) {
                const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(e.mesh.quaternion);
                const origin = e.mesh.position.clone().addScaledVector(fwd, 10);
                _missiles.push({
                    mesh: (() => {
                        const m = new THREE.Mesh(_missileGeom, _missileMat);
                        m.position.copy(origin);
                        m.quaternion.copy(e.mesh.quaternion);
                        _group.add(m);
                        return m;
                    })(),
                    dir: fwd.clone(),
                    life: 0,
                    target: playerPos,
                    lockType: 'hard'
                });
                e._aiFireCooldown = 4 + Math.random() * 3;
            }
        }

        // Update trail (ring buffer)
        const tr = e.trail;
        tr.head = (tr.head + 1) % _enemyTrailLen;
        const i3 = tr.head * 3;
        tr.pos[i3] = e.mesh.position.x;
        tr.pos[i3 + 1] = e.mesh.position.y;
        tr.pos[i3 + 2] = e.mesh.position.z;
        if (tr.count < _enemyTrailLen) tr.count++;
        tr.line.geometry.attributes.position.needsUpdate = true;

        const arr = tr.pos;
        const count = tr.count;
        if (count >= 2) {
            const drawArr = tr.line.geometry.attributes.position.array;
            for (let j = 0; j < count; j++) {
                const srcIdx = ((tr.head - j) % _enemyTrailLen + _enemyTrailLen) % _enemyTrailLen;
                drawArr[j * 3] = arr[srcIdx * 3];
                drawArr[j * 3 + 1] = arr[srcIdx * 3 + 1];
                drawArr[j * 3 + 2] = arr[srcIdx * 3 + 2];
            }
            tr.line.geometry.setDrawRange(0, count);
            tr.line.geometry.attributes.position.needsUpdate = true;
        }

        // Player lock timer accumulation
        if (_playerLockTargetId === e.id) {
            _playerLockTimer += dt;
            if (_playerLockTimer >= HARD_LOCK_TIME) {
                _playerLockState = 'hard';
            } else if (_playerLockTimer >= SOFT_LOCK_TIME) {
                _playerLockState = 'soft';
            }
        }
    }

    // Player lock decay if target destroyed
    if (_playerLockTargetId !== null) {
        const stillExists = _enemies.some(e => e.id === _playerLockTargetId);
        if (!stillExists) {
            _playerLockTargetId = null;
            _playerLockTimer = 0;
            _playerLockState = 'none';
        }
    }

    // Explosion particles
    for (let i = _explosions.length - 1; i >= 0; i--) {
        const e = _explosions[i];
        const elapsed = now - e.userData.start;
        const isSmoke = e.userData.isSmoke;
        const isHit = e.userData.hitParticles;
        const duration = isSmoke ? SMOKE_DURATION : (isHit ? 400 : EXPLOSION_DURATION);

        if (elapsed > duration) {
            _group.remove(e);
            e.geometry.dispose();
            e.material.dispose();
            _explosions.splice(i, 1);
            continue;
        }
        const progress = elapsed / duration;
        const pos = e.geometry.attributes.position;
        const vel = e.userData.velocities;
        for (let j = 0; j < pos.count; j++) {
            const dt2 = 1 / 60;
            pos.array[j * 3] += vel[j].x * dt2;
            pos.array[j * 3 + 1] += vel[j].y * dt2 - (isSmoke ? 1 : 5) * dt2;
            pos.array[j * 3 + 2] += vel[j].z * dt2;
        }
        pos.needsUpdate = true;

        if (isSmoke) {
            e.material.size = 8 + progress * 15;
            if (progress > 0.6) {
                e.material.opacity = 0.5 * (1 - (progress - 0.6) / 0.4);
            } else {
                e.material.opacity = 0.5;
            }
        } else {
            e.material.opacity = 1 - progress;
        }
    }
}
