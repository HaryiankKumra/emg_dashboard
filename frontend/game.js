'use strict';

/* ═══════════════════════════════════════════════════════
   MyoHurdle Protocol — game.js
   ─────────────────────────────────────────────────────
   Research-grade EMG biofeedback hurdle training system.

   State machine:
     setup → calibrating → countdown →
       [approaching → at_hurdle → (jumping | hit)] × N
     → results

   Controls:
     • EMG forearm flex above threshold → JUMP
     • SPACE / ArrowUp = keyboard simulation (full flex)

   Analytics per hurdle:
     { attempts[], peakEMG, timeToThreshold, outcome }
═══════════════════════════════════════════════════════ */

// ── Hoisted vars (avoid TDZ) ─────────────────────────
var ws = null;
var wsDelay = 1200;
var rafId = null;
var lastTs = null;
var calibInterval = null;
var restInterval = null;
var calibElapsed = 0;
var flexThresholdHeld = 0;
var flexTimer = 0;
var sessionStartTime = 0;
var particles = [];
var shake = { x: 0, y: 0, t: 0, mag: 0 };
var waveHistories = { 1: [], 2: [], 3: [], 4: [] };
var waveHistoryCombined = [];
var lastEmgMsg = null;
var WAVE_POINTS = 120;    // how many samples in the waveform

// ── EMG live state ───────────────────────────────────
var EMG = {
  rms: 0,
  channel: '?',
  live: false,
};

// ── Session config (from setup form) ─────────────────
var SESSION = {
  participantName: '',
  sex: 'male',
  age: 25,
  weight_kg: 70,
  height_cm: 170,
  exercise: 'squat',
  trial_no: 1,
  sessionId: '',
  numHurdles: 10,
  attemptTimeLimit: 5,
  threshold: 30,
  baseline: 4,
  calibrated: false,
  activeChannels: [1],   // array of active channels, e.g. [1, 2], [1, 2, 3, 4], or [0] for Auto
  combMode: 'avg',       // avg | max | min
};

// ── Per-hurdle log ────────────────────────────────────
// HURDLE_LOG[i] = {
//   hurdleIndex,
//   attempts: [{ startTime, endTime, outcome, peakEMG, timeToThreshold }],
//   completedAt
// }
var HURDLE_LOG = [];

// ── Game state ────────────────────────────────────────
var GAME = {
  phase: 'setup',
  // Phases: setup | calibrating | countdown |
  //         approaching | at_hurdle | jumping | hit | complete | results

  currentHurdle: 0,          // 0-indexed
  totalAttemptsThisHurdle: 0,
  currentAttemptStart: 0,    // ms timestamp
  currentPeakEMG: 0,

  // Character animation
  charFrac: 0,               // 0..1 position along track
  charY: 0,                  // vertical offset px (0=ground, neg=up)
  charVy: 0,                 // vertical velocity px/s
  charAnimT: 0,              // walking animation timer

  // Approach animation
  approachStartFrac: 0,
  approachTargetFrac: 0,
  approachT: 0,
  approachDur: 1.4,          // seconds

  // Hit animation
  hitTimer: 0,
};

// ── Canvas ────────────────────────────────────────────
var canvas = document.getElementById('game-canvas');
var ctx = canvas.getContext('2d');
var W = 0, H = 0;

function resize() {
  W = canvas.width  = canvas.offsetWidth;
  H = canvas.height = canvas.offsetHeight;
}
window.addEventListener('resize', resize);
resize();

// ── Layout constants ──────────────────────────────────
var TRACK_Y_FRAC = 0.70;     // track Y as fraction of canvas H
var TRACK_L_FRAC = 0.06;     // track left margin fraction
var TRACK_R_FRAC = 0.94;     // track right margin fraction
var CHAR_H = 36;             // character height in px
var CHAR_W = 14;
var HURDLE_W = 12;
var MAX_HURDLE_H = 120;      // tallest hurdle height px
var MIN_HURDLE_H = 40;       // shortest hurdle height px

// ══════════════════════════════════════════════════════
// RENDERING
// ══════════════════════════════════════════════════════

function render(dt) {
  ctx.save();

  // Screen shake
  if (shake.t > 0) {
    shake.t -= dt;
    var mag = shake.mag * (shake.t > 0 ? 1 : 0);
    ctx.translate(
      (Math.random() * 2 - 1) * mag,
      (Math.random() * 2 - 1) * mag
    );
  }

  ctx.clearRect(-20, -20, W + 40, H + 40);
  drawBackground();
  drawTrack();
  drawHurdles();
  drawCharacter(dt);
  drawParticles(dt);

  ctx.restore();
}

function drawBackground() {
  // Deep space gradient
  var bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0,    '#02040a');
  bg.addColorStop(0.55, '#040818');
  bg.addColorStop(1,    '#030610');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Subtle grid
  ctx.strokeStyle = 'rgba(0,229,200,0.025)';
  ctx.lineWidth = 1;
  var gridSz = 55;
  for (var gx = 0; gx < W; gx += gridSz) {
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
  }
  for (var gy = 0; gy < H; gy += gridSz) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
  }

  // Protocol name watermark
  ctx.font = 'bold 11px Orbitron';
  ctx.fillStyle = 'rgba(0,229,200,0.06)';
  ctx.textAlign = 'right';
  ctx.fillText('MyoHurdle Protocol v1.0', W - 20, H - 18);
  ctx.textAlign = 'left';
}

function drawTrack() {
  var ty = H * TRACK_Y_FRAC;
  var tx = W * TRACK_L_FRAC;
  var tr = W * TRACK_R_FRAC;

  // Ground fill
  var gGrad = ctx.createLinearGradient(0, ty, 0, H);
  gGrad.addColorStop(0,   'rgba(0,80,60,0.3)');
  gGrad.addColorStop(0.4, 'rgba(0,20,20,0.15)');
  gGrad.addColorStop(1,   'rgba(0,0,0,0.05)');
  ctx.fillStyle = gGrad;
  ctx.fillRect(0, ty, W, H - ty);

  // Lane background
  ctx.fillStyle = 'rgba(0,229,200,0.015)';
  ctx.fillRect(tx, ty - 2, tr - tx, 4);

  // Glowing track line
  ctx.shadowColor = 'rgba(0,229,200,0.5)';
  ctx.shadowBlur = 12;
  var lineGrad = ctx.createLinearGradient(tx, 0, tr, 0);
  lineGrad.addColorStop(0,   'rgba(0,229,200,0.1)');
  lineGrad.addColorStop(0.1, 'rgba(0,229,200,0.7)');
  lineGrad.addColorStop(0.9, 'rgba(0,229,200,0.7)');
  lineGrad.addColorStop(1,   'rgba(0,229,200,0.1)');
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tx, ty); ctx.lineTo(tr, ty);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // START / FINISH markers
  ctx.fillStyle = 'rgba(0,229,200,0.5)';
  ctx.font = '8px Orbitron';
  ctx.textAlign = 'center';
  ctx.fillText('START', tx + 2, ty + 18);
  ctx.fillText('FINISH', tr - 2, ty + 18);

  // Progress label (hurdle counter) above track
  if (GAME.phase !== 'setup' && GAME.phase !== 'calibrating' && GAME.phase !== 'countdown') {
    ctx.font = 'bold 10px Orbitron';
    ctx.fillStyle = 'rgba(0,229,200,0.7)';
    ctx.textAlign = 'center';
    ctx.fillText(
      'HURDLE ' + (GAME.currentHurdle + 1) + ' / ' + SESSION.numHurdles,
      W / 2, ty - 22
    );
  }
}

function hurdleX(index) {
  var tx = W * TRACK_L_FRAC;
  var tw = W * (TRACK_R_FRAC - TRACK_L_FRAC);
  return tx + tw * ((index + 1) / (SESSION.numHurdles + 1));
}

function hurdleFrac(index) {
  return (index + 1) / (SESSION.numHurdles + 1);
}

function hurdleVisualH() {
  // Hurdle height proportional to threshold difficulty.
  // Baseline: if threshold = 30 mV → MIN_HURDLE_H
  //           if threshold = 300 mV → MAX_HURDLE_H
  var t = (SESSION.threshold - 10) / 290;
  t = Math.max(0, Math.min(1, t));
  return MIN_HURDLE_H + t * (MAX_HURDLE_H - MIN_HURDLE_H);
}

function drawHurdles() {
  var ty  = H * TRACK_Y_FRAC;
  var hH  = hurdleVisualH();
  var now = Date.now();

  for (var i = 0; i < SESSION.numHurdles; i++) {
    var hx = hurdleX(i);
    var state; // 'done' | 'current' | 'future'
    if      (i < GAME.currentHurdle)  state = 'done';
    else if (i === GAME.currentHurdle) state = 'current';
    else                               state = 'future';

    drawSingleHurdle(hx, ty, hH, i + 1, state, now);
  }
}

function drawSingleHurdle(hx, ty, hH, num, state, now) {
  var hw = HURDLE_W;
  var top = ty - hH;

  ctx.textAlign = 'center';

  if (state === 'done') {
    // Soft green — completed
    ctx.fillStyle   = 'rgba(0,201,122,0.10)';
    ctx.strokeStyle = 'rgba(0,201,122,0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(hx - hw/2, top, hw, hH);
    ctx.fill(); ctx.stroke();

    // Checkmark
    ctx.strokeStyle = '#00c97a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hx - 5, ty - hH/2 + 2);
    ctx.lineTo(hx - 1, ty - hH/2 + 7);
    ctx.lineTo(hx + 6, ty - hH/2 - 6);
    ctx.stroke();

    // Number
    ctx.fillStyle = 'rgba(0,201,122,0.55)';
    ctx.font = '8px Orbitron';
    ctx.fillText(num, hx, ty + 16);

  } else if (state === 'current') {
    var pulse = 0.65 + 0.35 * Math.sin(now / 280);
    var inFlex = GAME.phase === 'at_hurdle' || GAME.phase === 'jumping';

    ctx.shadowColor = 'rgba(0,229,200,' + (0.5 * pulse) + ')';
    ctx.shadowBlur  = 20 * pulse;
    ctx.fillStyle   = 'rgba(0,229,200,' + (0.10 * pulse) + ')';
    ctx.strokeStyle = 'rgba(0,229,200,' + (0.9 * pulse) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(hx - hw/2, top, hw, hH);
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;

    // Height indicator lines (shows difficulty)
    var bands = 4;
    for (var b = 1; b < bands; b++) {
      ctx.strokeStyle = 'rgba(0,229,200,' + (0.12 * pulse) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx - hw/2, top + hH * b/bands);
      ctx.lineTo(hx + hw/2, top + hH * b/bands);
      ctx.stroke();
    }

    // Arrow indicator
    ctx.fillStyle = 'rgba(0,229,200,' + (0.7 * pulse) + ')';
    ctx.font = '10px Orbitron';
    ctx.fillText('▼', hx, top - 8);

    // Number
    ctx.font = 'bold 9px Orbitron';
    ctx.fillStyle = 'rgba(0,229,200,0.9)';
    ctx.fillText(num, hx, ty + 16);

  } else {
    // Future hurdle — dim
    ctx.fillStyle   = 'rgba(255,255,255,0.025)';
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(hx - hw/2, top, hw, hH);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.font = '8px Orbitron';
    ctx.fillText(num, hx, ty + 16);
  }
}

function drawLimb(ctx, x1, y1, len1, len2, angle1, angle2, color, thickness) {
  var x2 = x1 + Math.sin(angle1) * len1;
  var y2 = y1 + Math.cos(angle1) * len1;
  var x3 = x2 + Math.sin(angle1 - angle2) * len2;
  var y3 = y2 + Math.cos(angle1 - angle2) * len2;

  ctx.strokeStyle = color;
  ctx.lineWidth = thickness;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.stroke();
}

function drawCharacter(dt) {
  GAME.charAnimT += dt;

  var ty  = H * TRACK_Y_FRAC;
  var tx  = W * TRACK_L_FRAC;
  var tw  = W * (TRACK_R_FRAC - TRACK_L_FRAC);
  var cx  = tx + tw * GAME.charFrac;
  var cy  = ty - CHAR_H + GAME.charY;  // charY < 0 = above ground

  var phase = GAME.phase;
  var color = '#00e5c8';
  if (phase === 'jumping')   color = '#7fffcf';
  if (phase === 'hit')       color = '#ff7043';

  ctx.save();
  ctx.translate(cx, cy);

  ctx.shadowColor = color;
  ctx.shadowBlur = (phase === 'jumping') ? 28 : 10;

  // If hit, tumble/rotate!
  if (phase === 'hit') {
    var rot = (1.2 - GAME.hitTimer) * (Math.PI * 2);
    ctx.translate(0, -CHAR_H/2);
    ctx.rotate(rot);
    ctx.translate(0, CHAR_H/2);
  }

  // Define key coordinates:
  var hipY = -14;
  var hipXLeft = -2.5;
  var hipXRight = 2.5;

  var torsoLean = (phase === 'approaching') ? 0.22 : 0; // forward tilt in radians
  if (phase === 'jumping') torsoLean = -0.15; // backward tilt for jumping clearance!

  var shoulderY = -26;
  var shoulderXLeft = -3 + Math.sin(torsoLean) * 12;
  var shoulderXRight = 3 + Math.sin(torsoLean) * 12;

  // Compute running angles
  var runSpeed = 15;
  var cycle = GAME.charAnimT * runSpeed;

  var thighAngle1, kneeAngle1, thighAngle2, kneeAngle2;
  var armAngle1, forearmAngle1, armAngle2, forearmAngle2;

  if (phase === 'approaching') {
    // Dynamic running gait
    thighAngle1 = Math.sin(cycle) * 0.7 + 0.15;
    thighAngle2 = Math.sin(cycle + Math.PI) * 0.7 + 0.15;

    kneeAngle1 = (Math.cos(cycle + Math.PI / 3) * 0.5 + 0.5) * 1.25 + 0.1;
    kneeAngle2 = (Math.cos(cycle + Math.PI + Math.PI / 3) * 0.5 + 0.5) * 1.25 + 0.1;

    armAngle1 = -Math.sin(cycle) * 0.8;
    forearmAngle1 = (Math.sin(cycle + Math.PI / 2) * 0.35 + 0.65) * 1.3;

    armAngle2 = -Math.sin(cycle + Math.PI) * 0.8;
    forearmAngle2 = (Math.sin(cycle + Math.PI + Math.PI / 2) * 0.35 + 0.65) * 1.3;
  } else if (phase === 'jumping') {
    // Athletic hurdler leap pose
    thighAngle1 = 1.3; 
    kneeAngle1  = 0.9; 
    thighAngle2 = -0.9; 
    kneeAngle2  = 0.3; 

    armAngle1 = -1.1; forearmAngle1 = 0.5;
    armAngle2 = 1.1;  forearmAngle2 = 0.5;
  } else if (phase === 'hit') {
    // Sprawled out tumble pose
    thighAngle1 = 0.9; kneeAngle1 = 1.1;
    thighAngle2 = -0.5; kneeAngle2 = 1.3;
    armAngle1 = -1.3; forearmAngle1 = 0.8;
    armAngle2 = 1.3; forearmAngle2 = 0.8;
  } else {
    // Idle/Resting upright pose
    thighAngle1 = 0.05; kneeAngle1 = 0.05;
    thighAngle2 = -0.05; kneeAngle2 = 0.05;
    armAngle1 = 0.1; forearmAngle1 = 0.1;
    armAngle2 = -0.1; forearmAngle2 = 0.1;
  }

  // Draw Layers for depth (Back Arm -> Back Leg -> Torso/Head -> Front Leg -> Front Arm)
  drawLimb(ctx, shoulderXLeft, shoulderY, 7, 7, armAngle2, -forearmAngle2, color + 'aa', 2.2);
  drawLimb(ctx, hipXLeft, hipY, 9, 9, thighAngle2, kneeAngle2, color + 'aa', 3.0);

  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, hipY);
  ctx.lineTo(Math.sin(torsoLean) * 12, shoulderY);
  ctx.stroke();

  var neckX = Math.sin(torsoLean) * 12;
  var headX = neckX + Math.sin(torsoLean) * 4;
  var headY = shoulderY - 7;
  
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(headX, headY, 4.5, 0, Math.PI * 2);
  ctx.fill();

  drawLimb(ctx, hipXRight, hipY, 9, 9, thighAngle1, kneeAngle1, color, 3.3);
  drawLimb(ctx, shoulderXRight, shoulderY, 7, 7, armAngle1, -forearmAngle1, color, 2.5);

  ctx.shadowBlur = 0;
  ctx.restore();
}

// ── Particles ─────────────────────────────────────────
function addParticles(x, y, color, count, speedMult) {
  for (var i = 0; i < count; i++) {
    var angle = (Math.PI * 2 * i / count) + (Math.random() - 0.5) * 0.6;
    var speed = (80 + Math.random() * 180) * (speedMult || 1);
    particles.push({
      x: x, y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 60,
      life: 0.45 + Math.random() * 0.35,
      maxLife: 0.8,
      r: 2.5 + Math.random() * 3,
      color: color,
    });
  }
}

function drawParticles(dt) {
  for (var i = particles.length - 1; i >= 0; i--) {
    var p = particles[i];
    p.x   += p.vx * dt;
    p.y   += p.vy * dt;
    p.vy  += 350 * dt;
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    var a = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = a;
    ctx.fillStyle   = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur  = 7;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur  = 0;
}

// ══════════════════════════════════════════════════════
// WAVEFORM (live EMG trace in flex panel)
// ══════════════════════════════════════════════════════

function updateWaveform() {
  // Push current values to histories at frame rate
  var msg = lastEmgMsg;
  if (msg && msg.channels) {
    [1, 2, 3, 4].forEach(function(chId) {
      var chObj = msg.channels.find(function(c) { return c.ch === chId; });
      var val = chObj ? (chObj.rms || 0) : 0;
      if (!waveHistories[chId]) waveHistories[chId] = [];
      waveHistories[chId].push(val);
      if (waveHistories[chId].length > WAVE_POINTS) waveHistories[chId].shift();
    });
  } else {
    [1, 2, 3, 4].forEach(function(chId) {
      var active = SESSION.activeChannels || [1];
      var val = (EMG.live) ? 0 : (active.indexOf(chId) !== -1 || (active.length === 1 && active[0] === 0) ? EMG.rms : 0);
      if (!waveHistories[chId]) waveHistories[chId] = [];
      waveHistories[chId].push(val);
      if (waveHistories[chId].length > WAVE_POINTS) waveHistories[chId].shift();
    });
  }

  waveHistoryCombined.push(EMG.rms);
  if (waveHistoryCombined.length > WAVE_POINTS) waveHistoryCombined.shift();

  var wc = document.getElementById('wave-canvas');
  if (!wc) return;
  var wctx = wc.getContext('2d');
  var wW = wc.offsetWidth;
  var wH = 60;
  wc.width  = wW;
  wc.height = wH;

  wctx.clearRect(0, 0, wW, wH);

  // Draw threshold line
  var tPct = Math.min(SESSION.threshold / 300, 1);
  var tY   = wH - tPct * wH * 0.85 - 4;
  wctx.strokeStyle = 'rgba(255,255,255,0.2)';
  wctx.lineWidth = 1;
  wctx.setLineDash([4, 4]);
  wctx.beginPath();
  wctx.moveTo(0, tY); wctx.lineTo(wW, tY);
  wctx.stroke();
  wctx.setLineDash([]);

  var active = SESSION.activeChannels || [1];
  var isAuto = active.length === 1 && active[0] === 0;
  var step = wW / (WAVE_POINTS - 1);

  // 1. Draw individual active channels in their respective colors
  var chColors = {
    1: 'rgba(0, 229, 200, 0.45)',  // Teal
    2: 'rgba(255, 179, 0, 0.45)',  // Amber
    3: 'rgba(157, 78, 221, 0.45)',  // Purple
    4: 'rgba(255, 53, 122, 0.45)'   // Magenta
  };

  var channelsToDraw = isAuto ? [1, 2, 3, 4] : active;
  channelsToDraw.forEach(function(ch) {
    var pts = waveHistories[ch];
    if (!pts || pts.length < 2) return;

    wctx.strokeStyle = chColors[ch] || 'rgba(255,255,255,0.3)';
    wctx.lineWidth = 1;
    wctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var px = i * step;
      var py = wH - (Math.min(pts[i], 300) / 300) * wH * 0.85 - 4;
      if (i === 0) wctx.moveTo(px, py);
      else         wctx.lineTo(px, py);
    }
    wctx.stroke();
  });

  // 2. Draw combined signal as a thick glowing white line
  if (waveHistoryCombined.length >= 2) {
    var pts = waveHistoryCombined;
    var grad = wctx.createLinearGradient(0, 0, wW, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0.4)');
    grad.addColorStop(1, 'rgba(255,255,255,0.95)');
    
    wctx.strokeStyle = grad;
    wctx.lineWidth = 2.2;
    wctx.shadowColor = '#ffffff';
    wctx.shadowBlur = 4;
    wctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var px = i * step;
      var py = wH - (Math.min(pts[i], 300) / 300) * wH * 0.85 - 4;
      if (i === 0) wctx.moveTo(px, py);
      else         wctx.lineTo(px, py);
    }
    wctx.stroke();
    wctx.shadowBlur = 0;

    // Fill area below combined line
    wctx.lineTo((pts.length - 1) * step, wH);
    wctx.lineTo(0, wH);
    wctx.closePath();
    var fillGrad = wctx.createLinearGradient(0, 0, 0, wH);
    fillGrad.addColorStop(0, 'rgba(0,229,200,0.1)');
    fillGrad.addColorStop(1, 'rgba(0,229,200,0)');
    wctx.fillStyle = fillGrad;
    wctx.fill();
  }
}

// ══════════════════════════════════════════════════════
// GAME LOOP
// ══════════════════════════════════════════════════════

function gameLoop(ts) {
  if (!lastTs) lastTs = ts;
  var dt = Math.min((ts - lastTs) / 1000, 0.05);
  lastTs = ts;

  update(dt);
  render(dt);
  updateWaveform();

  rafId = requestAnimationFrame(gameLoop);
}

function startLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  lastTs = null;
  rafId  = requestAnimationFrame(gameLoop);
}

// ══════════════════════════════════════════════════════
// GAME UPDATE — state machine
// ══════════════════════════════════════════════════════

function update(dt) {
  if (GAME.phase === 'approaching') {
    updateApproach(dt);
  } else if (GAME.phase === 'at_hurdle') {
    updateAtHurdle(dt);
  } else if (GAME.phase === 'jumping') {
    updateJump(dt);
  } else if (GAME.phase === 'hit') {
    updateHit(dt);
  }
}

// ── Approach phase (walk to next hurdle) ──────────────
function updateApproach(dt) {
  GAME.approachT += dt;
  var t = Math.min(GAME.approachT / GAME.approachDur, 1);
  // Ease in-out cubic
  t = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;

  GAME.charFrac = lerp(GAME.approachStartFrac, GAME.approachTargetFrac, t);

  if (GAME.approachT >= GAME.approachDur) {
    beginAtHurdle();
  }
}

// ── At-hurdle phase ───────────────────────────────────
function updateAtHurdle(dt) {
  // Track peak EMG
  if (EMG.rms > GAME.currentPeakEMG) {
    GAME.currentPeakEMG = EMG.rms;
    $('fs-peak').textContent = Math.round(GAME.currentPeakEMG) + ' mV';
  }

  // Update power bar
  updatePowerBar();

  // Check threshold (must hold for 120 ms to avoid noise trigger)
  if (EMG.rms >= SESSION.threshold) {
    flexThresholdHeld += dt;
    if (flexThresholdHeld >= 0.12) {
      triggerJump();
      return;
    }
  } else {
    flexThresholdHeld = 0;
  }

  // Countdown
  flexTimer -= dt;
  updateCountdownRing(flexTimer / SESSION.attemptTimeLimit);
  $('cd-arc-num').textContent = Math.max(0, flexTimer).toFixed(1);

  // Change ring color as time expires
  var frac = flexTimer / SESSION.attemptTimeLimit;
  var arc = $('cd-arc');
  if (arc) {
    arc.setAttribute('stroke', frac < 0.3 ? '#ff3860' : frac < 0.6 ? '#ffb300' : '#00e5c8');
  }

  if (flexTimer <= 0) {
    triggerHit();
  }
}

function updatePowerBar() {
  var rms  = EMG.rms;
  var thr  = SESSION.threshold;
  var pct  = Math.min(rms / 300 * 100, 100);
  var fill = $('power-bar-fill');
  if (!fill) return;

  fill.style.width = pct + '%';
  fill.className = 'power-bar-fill';

  var ratio = rms / thr;
  if (ratio >= 1.0) {
    fill.classList.add('hit'); // success color
    $('power-instruct').textContent = 'HOLD IT! JUMPING!';
    $('power-instruct').className = 'power-instruct success';
  } else if (ratio >= 0.75) {
    fill.classList.add('near');
    $('power-instruct').textContent = 'ALMOST THERE — FLEX HARDER!';
    $('power-instruct').className = 'power-instruct active';
  } else if (ratio >= 0.3) {
    $('power-instruct').textContent = 'FLEX YOUR FOREARM!';
    $('power-instruct').className = 'power-instruct active';
  } else {
    $('power-instruct').textContent = 'FLEX YOUR FOREARM TO JUMP';
    $('power-instruct').className = 'power-instruct';
  }

  $('power-rms-display').textContent = Math.round(rms) + ' mV';
}

function updateCountdownRing(frac) {
  var arc = $('cd-arc');
  if (!arc) return;
  var circ = 163.4;
  arc.setAttribute('stroke-dashoffset', circ * (1 - Math.max(0, frac)));
}

// ── Jump phase ────────────────────────────────────────
function updateJump(dt) {
  var grav = 1900;
  GAME.charVy += grav * dt;
  GAME.charY  += GAME.charVy * dt;
  GAME.charFrac += 0.7 * dt * (1 / (SESSION.numHurdles + 1)); // advance past hurdle

  if (GAME.charY >= 0) {
    GAME.charY  = 0;
    GAME.charVy = 0;
    onLanded();
  }
}

// ── Hit phase ─────────────────────────────────────────
function updateHit(dt) {
  GAME.hitTimer -= dt;
  if (GAME.hitTimer <= 0) {
    // Retry same hurdle: walk back to approach position
    beginApproach(GAME.currentHurdle);
  }
}

// ══════════════════════════════════════════════════════
// GAME EVENTS
// ══════════════════════════════════════════════════════

function beginApproach(hurdleIndex) {
  GAME.phase = 'approaching';
  GAME.approachT = 0;
  GAME.approachStartFrac  = GAME.charFrac;
  // Target: stop just before the hurdle
  GAME.approachTargetFrac = hurdleFrac(hurdleIndex) - 0.018;
  GAME.approachTargetFrac = Math.max(GAME.charFrac, GAME.approachTargetFrac);
  // Speed: normalize so longer gaps take more time
  var dist = Math.abs(GAME.approachTargetFrac - GAME.charFrac);
  GAME.approachDur = Math.max(0.6, dist * (SESSION.numHurdles + 1) * 1.4);
}

function beginAtHurdle() {
  GAME.phase = 'at_hurdle';
  GAME.currentAttemptStart = Date.now();
  GAME.currentPeakEMG = 0;
  flexThresholdHeld = 0;
  flexTimer = SESSION.attemptTimeLimit;
  waveHistories = { 1: [], 2: [], 3: [], 4: [] };
  waveHistoryCombined = [];

  // Increment attempt counter for this hurdle
  GAME.totalAttemptsThisHurdle++;
  if (!HURDLE_LOG[GAME.currentHurdle]) {
    HURDLE_LOG[GAME.currentHurdle] = {
      hurdleIndex: GAME.currentHurdle,
      attempts: [],
      completedAt: null,
    };
  }

  showFlexOverlay();
}

function triggerJump() {
  GAME.phase = 'jumping';
  GAME.charVy = -490;
  flexThresholdHeld = 0;

  // Log successful attempt
  var attempt = makeAttemptRecord('success');
  HURDLE_LOG[GAME.currentHurdle].attempts.push(attempt);

  hideFlexOverlay();

  // Particles at hurdle position
  var hx = W * TRACK_L_FRAC + W * (TRACK_R_FRAC - TRACK_L_FRAC) * hurdleFrac(GAME.currentHurdle);
  var ty = H * TRACK_Y_FRAC;
  addParticles(hx, ty - hurdleVisualH() / 2, '#00c97a', 18, 1.2);

  // Flash overlay briefly green
  var ov = document.querySelector('.overlay:not(.hidden)');
  // Flash the app background
  flashScreen('green');
}

function triggerHit() {
  GAME.phase = 'hit';
  GAME.hitTimer = 1.2;
  flexThresholdHeld = 0;

  // Log failed attempt
  var attempt = makeAttemptRecord('fail');
  HURDLE_LOG[GAME.currentHurdle].attempts.push(attempt);

  hideFlexOverlay();

  shake.t   = 0.35;
  shake.mag = 10;

  // Particles at hurdle position (fail color)
  var hx = W * TRACK_L_FRAC + W * (TRACK_R_FRAC - TRACK_L_FRAC) * hurdleFrac(GAME.currentHurdle);
  var ty = H * TRACK_Y_FRAC;
  addParticles(hx, ty - 20, '#ff3860', 12, 0.9);

  flashScreen('red');
}

function onLanded() {
  // Log completion for current hurdle
  if (HURDLE_LOG[GAME.currentHurdle]) {
    HURDLE_LOG[GAME.currentHurdle].completedAt = Date.now() - sessionStartTime;
  }

  GAME.currentHurdle++;
  GAME.totalAttemptsThisHurdle = 0;

  if (GAME.currentHurdle >= SESSION.numHurdles) {
    // ─── ALL HURDLES DONE ───
    GAME.phase = 'complete';
    setTimeout(completeSession, 900);
  } else {
    // ─── NEXT HURDLE (with Rest Period) ───
    beginRestPhase();
  }
}

function makeAttemptRecord(outcome) {
  var now = Date.now();
  var duration = now - GAME.currentAttemptStart;
  var trace = waveHistoryCombined.slice();
  var meanEMG = 0;
  if (trace.length) {
    meanEMG = trace.reduce(function(s, v) { return s + v; }, 0) / trace.length;
  }
  return {
    startTime_ms:        GAME.currentAttemptStart - sessionStartTime,
    endTime_ms:          now - sessionStartTime,
    duration_ms:         duration,
    outcome:             outcome,
    peakEMG_mV:          round2(GAME.currentPeakEMG),
    meanEMG_mV:          round2(meanEMG),
    timeToThreshold_ms:  outcome === 'success' ? duration : null,
    channel:             EMG.channel,
    threshold_mV:        round2(SESSION.threshold),
    baseline_mV:         round2(SESSION.baseline),
    emg_trace_hz:        trace.length && duration > 0
      ? round2(trace.length / (duration / 1000))
      : null,
    emg_trace_mV:        trace,
  };
}

// ══════════════════════════════════════════════════════
// FLEX OVERLAY UI
// ══════════════════════════════════════════════════════

function showFlexOverlay() {
  $('flex-overlay').classList.remove('hidden');

  $('flex-hurdle-id').textContent      = 'HURDLE ' + (GAME.currentHurdle + 1) + ' / ' + SESSION.numHurdles;
  $('flex-attempt-badge').textContent  = 'ATTEMPT ' + GAME.totalAttemptsThisHurdle;
  $('power-lbl-right').textContent     = 'TARGET (' + Math.round(SESSION.threshold) + ' mV)';
  $('fs-target').textContent           = Math.round(SESSION.threshold) + ' mV';
  $('fs-attempts').textContent         = GAME.totalAttemptsThisHurdle;
  $('fs-peak').textContent             = '0 mV';
  $('fs-channel').textContent          = 'CH' + EMG.channel;
  $('power-rms-display').textContent   = '0 mV';
  $('power-instruct').textContent      = 'FLEX YOUR FOREARM TO JUMP';
  $('power-instruct').className        = 'power-instruct';

  // Position threshold line
  var tPct = Math.min(SESSION.threshold / 300 * 100, 96);
  $('power-thr-line').style.left = tPct + '%';

  // Reset ring
  updateCountdownRing(1);
  $('cd-arc').setAttribute('stroke', '#00e5c8');
  $('cd-arc-num').textContent = SESSION.attemptTimeLimit.toFixed(1);
  $('power-bar-fill').style.width = '0%';
  $('power-bar-fill').className = 'power-bar-fill';
}

function hideFlexOverlay() {
  $('flex-overlay').classList.add('hidden');
}

// ══════════════════════════════════════════════════════
// SESSION COMPLETE → RESULTS
// ══════════════════════════════════════════════════════

function completeSession() {
  GAME.phase = 'results';
  stopGameEMGRecording();
  buildResults();
  showOverlay('results-overlay');
}

function buildResults() {
  var totalAttempts = HURDLE_LOG.reduce(function(s, h) { return s + (h ? h.attempts.length : 0); }, 0);
  var totalTime = (Date.now() - sessionStartTime) / 1000;
  var efficiency = ((SESSION.numHurdles / Math.max(totalAttempts, 1)) * 100).toFixed(1);

  // Avg peak EMG across successful attempts
  var peaks = HURDLE_LOG.map(function(h) {
    if (!h) return 0;
    var s = h.attempts.find(function(a) { return a.outcome === 'success'; });
    return s ? s.peakEMG_mV : 0;
  });
  var avgPeak = peaks.reduce(function(s, v) { return s + v; }, 0) / peaks.length;

  // Summary cards
  $('results-sid').textContent = 'SESSION · ' + SESSION.sessionId;
  $('results-summary').innerHTML =
    rCard(SESSION.participantName || '—', 'PARTICIPANT') +
    rCard(SESSION.sex + ' · ' + SESSION.age + 'y', 'SEX / AGE') +
    rCard(SESSION.exercise.replace('_', ' '), 'EXERCISE') +
    rCard('Trial ' + SESSION.trial_no, 'TRIAL') +
    rCard(SESSION.numHurdles, 'HURDLES CLEARED') +
    rCard(totalAttempts, 'TOTAL ATTEMPTS') +
    rCard(totalTime.toFixed(1) + 's', 'SESSION TIME') +
    rCard(efficiency + '%', 'EFFICIENCY') +
    rCard(Math.round(SESSION.threshold) + ' mV', 'TARGET THRESHOLD') +
    rCard(Math.round(avgPeak) + ' mV', 'AVG PEAK EMG') +
    rCard(SESSION.weight_kg + ' kg', 'WEIGHT') +
    rCard(SESSION.attemptTimeLimit + 's', 'TIME LIMIT / HURDLE');

  // Per-hurdle table
  var tbody = $('results-tbody');
  tbody.innerHTML = '';
  for (var i = 0; i < SESSION.numHurdles; i++) {
    var h = HURDLE_LOG[i];
    if (!h) continue;
    var nattempts  = h.attempts.length;
    var success    = h.attempts.find(function(a) { return a.outcome === 'success'; });
    var peakEMG    = success ? Math.round(success.peakEMG_mV) : '—';
    var timeToAct  = success && success.timeToThreshold_ms != null
      ? Math.round(success.timeToThreshold_ms) : '—';
    var clearedAt  = h.completedAt ? (h.completedAt / 1000).toFixed(1) + 's' : '—';
    var effTxt     = nattempts === 1 ? '✓ First try' : nattempts + ' attempts';
    var effCls     = nattempts === 1 ? 'good' : nattempts > 3 ? 'warn' : '';

    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + (i + 1) + '</td>' +
      '<td>' + nattempts + '</td>' +
      '<td>' + clearedAt + '</td>' +
      '<td>' + peakEMG + '</td>' +
      '<td>' + Math.round(SESSION.threshold) + '</td>' +
      '<td>' + timeToAct + '</td>' +
      '<td class="' + effCls + '">' + effTxt + '</td>';
    tbody.appendChild(tr);
  }
}

function rCard(val, lbl) {
  return '<div class="rcard">' +
    '<span class="rcard-val">' + val + '</span>' +
    '<span class="rcard-lbl">' + lbl + '</span>' +
    '</div>';
}

function exportJSON() {
  var totalAttempts = HURDLE_LOG.reduce(function(s, h) { return s + (h ? h.attempts.length : 0); }, 0);
  var totalTime = (Date.now() - sessionStartTime) / 1000;

  var data = {
    schema_version: '2.0',
    sessionId:       SESSION.sessionId,
    timestamp:       new Date().toISOString(),
    participant: {
      id:          SESSION.participantName || 'anonymous',
      sex:         SESSION.sex,
      age:         SESSION.age,
      weight_kg:     SESSION.weight_kg,
      height_cm:     SESSION.height_cm,
    },
    protocol: {
      exercise:            SESSION.exercise,
      trial_no:            SESSION.trial_no,
      numHurdles:          SESSION.numHurdles,
      attemptTimeLimit_s:  SESSION.attemptTimeLimit,
      threshold_mV:        round2(SESSION.threshold),
      baseline_mV:         round2(SESSION.baseline),
      hurdleVisualH_px:    Math.round(hurdleVisualH()),
    },
    emg_recording: {
      sample_count:      EmgEngine.recorder ? EmgEngine.recorder.sampleCount : 0,
      session_timestamp: EmgEngine.recorder ? EmgEngine.recorder.getMeta().session_timestamp : null,
    },
    summary: {
      totalAttempts:   totalAttempts,
      totalTime_s:     round2(totalTime),
      efficiency_pct:  round2((SESSION.numHurdles / Math.max(totalAttempts, 1)) * 100),
    },
    hurdles: HURDLE_LOG.map(function(h, i) {
      if (!h) return null;
      return {
        hurdle:         i + 1,
        totalAttempts:  h.attempts.length,
        completedAt_ms: h.completedAt,
        attempts: h.attempts.map(function(a, idx) {
          return {
            attempt_no:          idx + 1,
            outcome:             a.outcome,
            startTime_ms:        a.startTime_ms,
            endTime_ms:          a.endTime_ms,
            duration_ms:         a.duration_ms,
            peakEMG_mV:          a.peakEMG_mV,
            meanEMG_mV:          a.meanEMG_mV,
            timeToThreshold_ms:  a.timeToThreshold_ms,
            channel:             a.channel,
            threshold_mV:        a.threshold_mV,
            baseline_mV:         a.baseline_mV,
            emg_trace_hz:        a.emg_trace_hz,
            emg_trace_mV:        a.emg_trace_mV,
          };
        }),
      };
    }).filter(Boolean),
  };

  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url;
  a.download = SESSION.participantName + '_trial' + SESSION.trial_no + '_' + SESSION.exercise + '_protocol.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportAttemptsCSV() {
  var header = [
    'participant', 'sex', 'age', 'weight_kg', 'height_cm', 'exercise', 'trial_no',
    'session_id', 'hurdle', 'attempt_no', 'outcome', 'peak_emg_mV', 'mean_emg_mV',
    'time_to_threshold_ms', 'duration_ms', 'channel', 'threshold_mV', 'baseline_mV',
  ];
  var rows = [header.join(',')];

  HURDLE_LOG.forEach(function(h, hi) {
    if (!h) return;
    h.attempts.forEach(function(a, ai) {
      rows.push([
        SESSION.participantName,
        SESSION.sex,
        SESSION.age,
        SESSION.weight_kg,
        SESSION.height_cm,
        SESSION.exercise,
        SESSION.trial_no,
        SESSION.sessionId,
        hi + 1,
        ai + 1,
        a.outcome,
        a.peakEMG_mV,
        a.meanEMG_mV,
        a.timeToThreshold_ms != null ? a.timeToThreshold_ms : '',
        a.duration_ms,
        a.channel,
        a.threshold_mV,
        a.baseline_mV,
      ].join(','));
    });
  });

  if (rows.length <= 1) return;

  var name = SESSION.participantName + '_trial' + SESSION.trial_no + '_' + SESSION.exercise + '_attempts.csv';
  EmgEngine._downloadText(rows.join('\n'), name);
}

function exportGameEMGCSV(filtered) {
  if (typeof EmgEngine === 'undefined') return;
  if (!EmgEngine.downloadRecorderCSV(filtered)) {
    alert('No EMG samples recorded for this session. Ensure the device was connected.');
  }
}

// ══════════════════════════════════════════════════════
// CALIBRATION (sample flex)
// ══════════════════════════════════════════════════════

var calibSamples = [];
var calibBase = 0;
var calibPhase = 'idle'; // idle | relax | flex

function startSampleFlex() {
  calibPhase   = 'relax';
  calibSamples = [];
  calibElapsed = 0;
  calibBase    = 0;

  // Show calib overlay
  showOverlay('calib-overlay');
  $('calib-phase-label').textContent = 'PHASE 1 / 2 — BASELINE';
  $('calib-instr').textContent       = '🧘 Relax your forearm completely…';
  $('calib-count').textContent       = '3';
  $('calib-note').textContent        = 'Recording resting baseline…';

  $('setup-live-wrap').classList.remove('hidden');
  startLoop();

  clearInterval(calibInterval);
  calibInterval = setInterval(tickCalib, 80);
}

function tickCalib() {
  calibElapsed += 0.08;
  var rms = EMG.rms;
  calibSamples.push(rms);

  // Live bars
  var pct = Math.min(rms / 300 * 100, 100);
  $('calib-bar-fg').style.width  = pct + '%';
  $('calib-bar-rms').textContent = Math.round(rms) + ' mV';
  $('setup-live-fg').style.width = pct + '%';
  $('setup-live-rms').textContent = Math.round(rms) + ' mV';

  var total = calibPhase === 'relax' ? 3 : 3.5;
  var rem   = Math.max(0, Math.ceil(total - calibElapsed));
  $('calib-count').textContent = rem;

  if (calibElapsed >= total) {
    if (calibPhase === 'relax') {
      // Baseline done
      calibBase = calibSamples.reduce(function(s,v){return s+v;},0) / calibSamples.length;
      SESSION.baseline = calibBase;
      calibSamples = [];
      calibElapsed = 0;
      calibPhase   = 'flex';

      $('calib-phase-label').textContent = 'PHASE 2 / 2 — TARGET FLEX';
      $('calib-instr').textContent       = '💪 Flex at your DESIRED effort level and hold it!';
      $('calib-count').textContent       = '3';
      $('calib-note').textContent        = 'Recording your target strength…';
    } else {
      // Sample flex done
      var peakFlex = Math.max.apply(null, calibSamples);
      // Threshold = 85% of peak (allows a bit of headroom)
      SESSION.threshold  = Math.max(calibBase + 5, peakFlex * 0.85);
      SESSION.calibrated = true;

      clearInterval(calibInterval);
      calibPhase = 'idle';

      // Return to setup screen
      showOverlay('setup-overlay');

      $('calib-result-badge').classList.remove('hidden');
      $('calib-result-mV').textContent = Math.round(SESSION.threshold) + ' mV';
      $('start-btn').disabled = false;
    }
  }
}

function skipCalib() {
  clearInterval(calibInterval);
  calibPhase = 'idle';
  SESSION.threshold  = 30;
  SESSION.baseline   = 4;
  SESSION.calibrated = true;

  // Return to setup screen
  showOverlay('setup-overlay');
  $('calib-result-badge').classList.remove('hidden');
  $('calib-result-mV').textContent = '30 mV (default)';
  $('start-btn').disabled = false;
}

// ══════════════════════════════════════════════════════
// SETUP → START PROTOCOL
// ══════════════════════════════════════════════════════

function initSetupForm() {
  $('inp-hurdles').addEventListener('input', function() {
    SESSION.numHurdles = parseInt(this.value);
    $('hurdles-val').textContent = this.value;
  });
  $('inp-timelimit').addEventListener('input', function() {
    SESSION.attemptTimeLimit = parseInt(this.value);
    $('timelimit-val').textContent = this.value + ' s';
  });

  // ── Channel picker ────────────────────────────────
  var chBtns = document.querySelectorAll('.ch-btn');
  chBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var ch = parseInt(this.getAttribute('data-ch'));
      if (!SESSION.activeChannels) SESSION.activeChannels = [1];
      
      if (ch === 0) {
        // Auto mode
        SESSION.activeChannels = [0];
        chBtns.forEach(function(b) {
          if (parseInt(b.getAttribute('data-ch')) === 0) b.classList.add('active');
          else b.classList.remove('active');
        });
      } else {
        // Specific channel toggled
        var index0 = SESSION.activeChannels.indexOf(0);
        if (index0 !== -1) SESSION.activeChannels.splice(index0, 1);
        $('ch-btn-0').classList.remove('active');
        
        var index = SESSION.activeChannels.indexOf(ch);
        if (index !== -1) {
          if (SESSION.activeChannels.length > 1) {
            SESSION.activeChannels.splice(index, 1);
            this.classList.remove('active');
          }
        } else {
          SESSION.activeChannels.push(ch);
          this.classList.add('active');
        }
      }
      
      // Update visibility of the combination mode select
      var combRow = $('comb-mode-row');
      if (combRow) {
        combRow.style.display = SESSION.activeChannels.length > 1 ? 'block' : 'none';
      }
      
      SESSION.activeChannels.sort(function(a, b) { return a - b; });

      var label = SESSION.activeChannels.map(function(c) { return c === 0 ? 'AUTO' : 'CH' + c; }).join('+');
      var preview = $('ch-live-preview');
      if (preview) preview.textContent = 'Live RMS: — mV  [' + label + ' selected]';
    });
  });

  var combModeSelect = $('inp-comb-mode');
  if (combModeSelect) {
    combModeSelect.addEventListener('change', function() {
      SESSION.combMode = this.value;
    });
  }

  $('calib-sample-btn').addEventListener('click', startSampleFlex);
  $('skip-calib-btn').addEventListener('click', skipCalib);
  $('start-btn').addEventListener('click', startProtocol);
  $('export-btn').addEventListener('click', exportJSON);
  $('export-attempts-btn').addEventListener('click', exportAttemptsCSV);
  $('export-emg-filtered-btn').addEventListener('click', function() { exportGameEMGCSV(true); });
  $('export-emg-raw-btn').addEventListener('click', function() { exportGameEMGCSV(false); });
  $('new-session-btn').addEventListener('click', resetToSetup);
}


function readGameSessionMeta() {
  return {
    participant: $('inp-name').value.trim() || 'P001',
    sex: $('inp-sex').value || 'male',
    age: parseInt($('inp-age').value, 10) || 25,
    weight_kg: parseFloat($('inp-weight').value) || 70,
    height_cm: parseFloat($('inp-height').value) || 170,
    exercise: $('inp-exercise').value || 'squat',
    trial_no: parseInt($('inp-trial').value, 10) || 1,
    label: $('inp-exercise').value || 'squat',
  };
}

function startGameEMGRecording() {
  if (typeof EmgEngine === 'undefined') return;
  var meta = readGameSessionMeta();
  EmgEngine.resetFilters();
  EmgEngine.recorder.start(meta);
}

function stopGameEMGRecording() {
  if (typeof EmgEngine !== 'undefined' && EmgEngine.recorder.isRecording) {
    EmgEngine.recorder.stop();
  }
}

function startProtocol() {
  var meta = readGameSessionMeta();
  SESSION.participantName  = meta.participant;
  SESSION.sex            = meta.sex;
  SESSION.age            = meta.age;
  SESSION.weight_kg      = meta.weight_kg;
  SESSION.height_cm      = meta.height_cm;
  SESSION.exercise       = meta.exercise;
  SESSION.trial_no       = meta.trial_no;
  SESSION.numHurdles       = parseInt($('inp-hurdles').value);
  SESSION.attemptTimeLimit = parseInt($('inp-timelimit').value);

  // Auto session ID
  var ts = new Date();
  SESSION.sessionId = 'MH_' +
    ts.getFullYear() +
    pad2(ts.getMonth() + 1) +
    pad2(ts.getDate()) + '_' +
    pad2(ts.getHours()) +
    pad2(ts.getMinutes()) + '_' +
    Math.floor(Math.random() * 900 + 100);

  // Reset game
  GAME.phase = 'setup';
  GAME.currentHurdle = 0;
  GAME.charFrac  = 0;
  GAME.charY     = 0;
  GAME.charVy    = 0;
  GAME.charAnimT = 0;
  GAME.totalAttemptsThisHurdle = 0;
  HURDLE_LOG.length = 0;
  particles.length  = 0;
  waveHistories = { 1: [], 2: [], 3: [], 4: [] };
  waveHistoryCombined = [];

  hideOverlay('setup-overlay');
  beginCountdown();
}

function beginCountdown() {
  if (restInterval) clearInterval(restInterval);
  showOverlay('cd-overlay');
  $('cd-big').textContent = '1';
  $('cd-sub').textContent = 'GET READY';
  $('cd-sub').style.color = '';
  startLoop();

  var n = 1;
  restInterval = setInterval(function() {
    n--;
    if (n > 0) {
      $('cd-big').textContent = n;
    } else {
      $('cd-big').textContent = 'GO!';
      $('cd-sub').textContent = '💪 FLEX TO JUMP!';
      clearInterval(restInterval);
      restInterval = null;
      setTimeout(function() {
        hideOverlay('cd-overlay');
        sessionStartTime = Date.now();
        startGameEMGRecording();
        GAME.charFrac = 0;
        beginApproach(0);
      }, 800);
    }
  }, 950);
}

function beginRestPhase() {
  GAME.phase = 'resting';
  showOverlay('cd-overlay');
  
  if (restInterval) clearInterval(restInterval);

  var secondsLeft = 2;
  $('cd-big').textContent = secondsLeft;
  $('cd-sub').textContent = 'REST & RELAX YOUR MUSCLE';
  $('cd-sub').style.color = '#ffb300';

  restInterval = setInterval(function() {
    secondsLeft--;
    if (secondsLeft > 0) {
      $('cd-big').textContent = secondsLeft;
    } else {
      clearInterval(restInterval);
      restInterval = null;
      beginReadyPhase();
    }
  }, 1000);
}

function beginReadyPhase() {
  var secondsLeft = 1;
  $('cd-big').textContent = secondsLeft;
  $('cd-sub').textContent = 'GET READY FOR NEXT HURDLE';
  $('cd-sub').style.color = '#00e5c8';

  restInterval = setInterval(function() {
    secondsLeft--;
    if (secondsLeft > 0) {
      $('cd-big').textContent = secondsLeft;
    } else {
      clearInterval(restInterval);
      restInterval = null;
      hideOverlay('cd-overlay');
      $('cd-sub').style.color = ''; // Restore default color
      beginApproach(GAME.currentHurdle);
    }
  }, 1000);
}

function resetToSetup() {
  if (restInterval) {
    clearInterval(restInterval);
    restInterval = null;
  }
  hideAllOverlays();
  SESSION.calibrated = false;
  $('start-btn').disabled = true;
  $('calib-result-badge').classList.add('hidden');
  showOverlay('setup-overlay');
}

// ══════════════════════════════════════════════════════
// OVERLAY MANAGEMENT
// ══════════════════════════════════════════════════════

var ALL_OVERLAYS = [
  'setup-overlay', 'calib-overlay', 'cd-overlay',
  'flex-overlay', 'results-overlay'
];

function showOverlay(id) {
  ALL_OVERLAYS.forEach(function(oid) {
    var el = $(oid);
    if (el) el.classList.toggle('hidden', oid !== id);
  });
}

function hideOverlay(id) {
  var el = $(id);
  if (el) el.classList.add('hidden');
}

function hideAllOverlays() {
  ALL_OVERLAYS.forEach(function(id) {
    var el = $(id);
    if (el) el.classList.add('hidden');
  });
}

// ══════════════════════════════════════════════════════
// EMG DATA — shared engine events (Web Serial)
// ══════════════════════════════════════════════════════

function connectEMG() {
  window.addEventListener('emg-update', onEmgUpdate);

  if (typeof SerialWeb !== 'undefined' && SerialWeb.isSupported()) {
    SerialWeb.reconnectGranted(921600).then(function(ok) {
      if (ok) {
        $('ws-dot').className = 'on';
        $('ws-lbl').textContent = 'EMG LINKED';
      }
    });
  }
}

function onEmgUpdate(ev) {
  var msg = ev.detail;
  if (!msg || msg.type !== 'channels' || !Array.isArray(msg.channels) || !msg.channels.length) return;

  lastEmgMsg = msg; // Save last message for graph rendering

  var live = msg.channels.filter(function(c) { return (c.sample_rate || 0) > 0; });
  var pool = live.length > 0 ? live : msg.channels;

  // Determine active channel configuration
  var activeChs = SESSION.activeChannels || [1];
  if (activeChs.length === 1 && activeChs[0] === 0) {
    // Auto: highest RMS among live channels
    var chosen = pool.reduce(function(b, c) { return (c.rms || 0) > (b.rms || 0) ? c : b; }, pool[0]);
    EMG.rms = chosen.rms || 0;
    EMG.channel = chosen.ch || '?';
  } else {
    // Specific channels mode: average, max, or min of selected channels
    var targetChannels = msg.channels.filter(function(c) { return activeChs.indexOf(c.ch) !== -1; });
    if (targetChannels.length === 0) {
      targetChannels = [pool[0]]; // fallback
    }
    
    var rmsValues = targetChannels.map(function(c) { return c.rms || 0; });
    var combVal = 0;
    if (SESSION.combMode === 'max') {
      combVal = Math.max.apply(null, rmsValues);
    } else if (SESSION.combMode === 'min') {
      combVal = Math.min.apply(null, rmsValues);
    } else {
      // default: avg
      var sum = rmsValues.reduce(function(a, b) { return a + b; }, 0);
      combVal = sum / rmsValues.length;
    }
    
    EMG.rms = combVal;
    EMG.channel = activeChs.join('+');
  }

  EMG.live = msg.connected && live.length > 0;

  $('ws-dot').className = EMG.live ? 'on' : (msg.connected ? 'on' : '');
  $('ws-lbl').textContent = EMG.live
    ? 'CH' + EMG.channel + ' · ' + Math.round(EMG.rms) + ' mV'
    : (msg.connected ? 'EMG WAITING' : 'EMG OFFLINE');

  if ($('fs-channel')) $('fs-channel').textContent = 'CH' + EMG.channel;

  // Update live RMS preview per button in setup panel
  var preview = $('ch-live-preview');
  if (preview) {
    var rmsVal = Math.round(EMG.rms);
    var label = activeChs.map(function(c) { return c === 0 ? 'AUTO' : 'CH' + c; }).join('+');
    if (activeChs.length > 1) {
      label += ' (' + SESSION.combMode.toUpperCase() + ')';
    }
    preview.textContent = 'Live RMS: ' + rmsVal + ' mV  [' + label + ']';
    preview.style.color = rmsVal > 50 ? '#00e5a0' : '#8b949e';
  }
}

// ══════════════════════════════════════════════════════
// KEYBOARD FALLBACK
// ══════════════════════════════════════════════════════

window.addEventListener('keydown', function(e) {
  if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault();
    // Simulate a strong flex (1.5× threshold for reliable trigger)
    EMG.rms = SESSION.threshold * 1.6;
    setTimeout(function() { EMG.rms = EMG.live ? EMG.rms : 0; }, 180);
  }
});

// ══════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════

function $(id)            { return document.getElementById(id); }
function lerp(a, b, t)    { return a + (b - a) * t; }
function pad2(n)          { return ('0' + n).slice(-2); }
function round2(v)        { return Math.round(v * 100) / 100; }

function flashScreen(color) {
  var app = document.getElementById('app');
  app.classList.remove('flash-green', 'flash-red');
  void app.offsetWidth; // force reflow
  app.classList.add(color === 'green' ? 'flash-green' : 'flash-red');
}

// ══════════════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════════════

initSetupForm();
if (typeof EmgEngine !== 'undefined') EmgEngine.startBroadcast();
connectEMG();

// Static canvas render while on setup screen
(function staticBg() {
  if (rafId) return;
  ctx.clearRect(0, 0, W, H);

  var bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#02040a');
  bg.addColorStop(1, '#040818');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Draw a preview of 10 hurdles on the track
  var previewN = 10;
  var ty = H * TRACK_Y_FRAC;
  var tx = W * TRACK_L_FRAC;
  var tr = W * TRACK_R_FRAC;
  var tw = tr - tx;

  ctx.shadowColor = 'rgba(0,229,200,0.4)';
  ctx.shadowBlur  = 10;
  ctx.strokeStyle = 'rgba(0,229,200,0.5)';
  ctx.lineWidth   = 2;
  ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tr, ty); ctx.stroke();
  ctx.shadowBlur  = 0;

  for (var i = 0; i < previewN; i++) {
    var hx = tx + tw * ((i + 1) / (previewN + 1));
    var hh = MIN_HURDLE_H + (MAX_HURDLE_H - MIN_HURDLE_H) * 0.35;
    ctx.fillStyle   = 'rgba(0,229,200,0.04)';
    ctx.strokeStyle = 'rgba(0,229,200,0.20)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(hx - HURDLE_W/2, ty - hh, HURDLE_W, hh);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(0,229,200,0.3)';
    ctx.font = '8px Orbitron'; ctx.textAlign = 'center';
    ctx.fillText(i + 1, hx, ty + 16);
  }

  ctx.fillStyle = 'rgba(0,229,200,0.06)';
  ctx.font = 'bold 11px Orbitron'; ctx.textAlign = 'right';
  ctx.fillText('MyoHurdle Protocol v1.0', W - 20, H - 18);

  requestAnimationFrame(staticBg);
})();
