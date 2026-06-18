'use strict';

/* ═══════════════════════════════════════════════════════
   MyoHurdle Protocol — game-renderer.js
   ─────────────────────────────────────────────────────
   All rendering code including canvas resize logic, character body,
   track, hurdles, particle physics, EMG waveforms, and electrode placement guide.
   ═══════════════════════════════════════════════════════ */

// ── Resize handler with 0px dimensions check ──────────
function resize() {
  if (!canvas) return;
  var dpr = window.devicePixelRatio || 1;
  var w = canvas.offsetWidth;
  var h = canvas.offsetHeight;
  if (w === 0 || h === 0) return; // Safeguard
  
  W = w;
  H = h;
  var targetWidth = Math.floor(W * dpr);
  var targetHeight = Math.floor(H * dpr);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  ctx.resetTransform();
  ctx.scale(dpr, dpr);
}
window.addEventListener('resize', resize);
resize();

// ── Main game screen render loop ─────────────────────
function render(dt) {
  if (W === 0 || H === 0) return;
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
    ctx.shadowColor = 'rgba(0,229,200,' + (0.5 * pulse) + ')';
    ctx.shadowBlur  = 20 * pulse;
    ctx.fillStyle   = 'rgba(0,229,200,' + (0.10 * pulse) + ')';
    ctx.strokeStyle = 'rgba(0,229,200,' + (0.9 * pulse) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(hx - hw/2, top, hw, hH);
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;

    // Height bands
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
    // Future hurdle
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
  var cy  = ty - CHAR_H + GAME.charY;

  var phase = GAME.phase;
  var color = '#00e5c8';
  if (phase === 'jumping')   color = '#7fffcf';
  if (phase === 'hit')       color = '#ff7043';

  ctx.save();
  ctx.translate(cx, cy);

  ctx.shadowColor = color;
  ctx.shadowBlur = (phase === 'jumping') ? 28 : 10;

  // If hit, rotate and fade out
  if (phase === 'hit') {
    var rot = (1.2 - GAME.hitTimer) * (Math.PI * 2);
    ctx.translate(0, -CHAR_H/2);
    ctx.rotate(rot);
    ctx.translate(0, CHAR_H/2);
    ctx.globalAlpha = Math.max(0, GAME.hitTimer / 1.2);
  }

  // Key coordinates
  var hipY = -14;
  var hipXLeft = -2.5;
  var hipXRight = 2.5;

  var torsoLean = (phase === 'approaching') ? 0.22 : 0;
  if (phase === 'jumping') torsoLean = -0.15;

  var shoulderY = -26;
  var shoulderXLeft = -3 + Math.sin(torsoLean) * 12;
  var shoulderXRight = 3 + Math.sin(torsoLean) * 12;

  // Joint Angles
  var runSpeed = 15;
  var cycle = GAME.charAnimT * runSpeed;

  var thighAngle1, kneeAngle1, thighAngle2, kneeAngle2;
  var armAngle1, forearmAngle1, armAngle2, forearmAngle2;

  if (phase === 'approaching') {
    thighAngle1 = Math.sin(cycle) * 0.7 + 0.15;
    thighAngle2 = Math.sin(cycle + Math.PI) * 0.7 + 0.15;
    kneeAngle1 = (Math.cos(cycle + Math.PI / 3) * 0.5 + 0.5) * 1.25 + 0.1;
    kneeAngle2 = (Math.cos(cycle + Math.PI + Math.PI / 3) * 0.5 + 0.5) * 1.25 + 0.1;
    armAngle1 = -Math.sin(cycle) * 0.8;
    forearmAngle1 = (Math.sin(cycle + Math.PI / 2) * 0.35 + 0.65) * 1.3;
    armAngle2 = -Math.sin(cycle + Math.PI) * 0.8;
    forearmAngle2 = (Math.sin(cycle + Math.PI + Math.PI / 2) * 0.35 + 0.65) * 1.3;
  } else if (phase === 'jumping') {
    thighAngle1 = 1.3; kneeAngle1  = 0.9;
    thighAngle2 = -0.9; kneeAngle2  = 0.3;
    armAngle1 = -1.1; forearmAngle1 = 0.5;
    armAngle2 = 1.1;  forearmAngle2 = 0.5;
  } else if (phase === 'hit') {
    thighAngle1 = 0.9; kneeAngle1 = 1.1;
    thighAngle2 = -0.5; kneeAngle2 = 1.3;
    armAngle1 = -1.3; forearmAngle1 = 0.8;
    armAngle2 = 1.3; forearmAngle2 = 0.8;
  } else {
    // Resting/idle
    thighAngle1 = 0.05; kneeAngle1 = 0.05;
    thighAngle2 = -0.05; kneeAngle2 = 0.05;
    armAngle1 = 0.1; forearmAngle1 = 0.1;
    armAngle2 = -0.1; forearmAngle2 = 0.1;
  }

  // Draw layers (Back limbs -> Torso -> Front limbs)
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

// ── Live waveform rendering with 0px dimensions check ──
function updateWaveform() {
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
  var wW = wc.offsetWidth;
  var wH = 60;
  if (wW === 0 || wH === 0) return; // Safeguard

  var wctx = wc.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  var targetWidth = Math.floor(wW * dpr);
  var targetHeight = Math.floor(wH * dpr);
  if (wc.width !== targetWidth || wc.height !== targetHeight) {
    wc.width  = targetWidth;
    wc.height = targetHeight;
  }
  wctx.resetTransform();
  wctx.scale(dpr, dpr);

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

  // Combined glowing line
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

    // Gradient fill below
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

// ── Anatomy Muscle activation guide with size checks ──
function updateAnatomyCanvas() {
  var canvas = $('anatomy-canvas');
  if (!canvas) return;
  var w = canvas.offsetWidth;
  var h = canvas.offsetHeight;
  if (w === 0 || h === 0) return; // Safeguard

  var actx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  var targetWidth = Math.floor(w * dpr);
  var targetHeight = Math.floor(h * dpr);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  actx.resetTransform();
  actx.scale(dpr, dpr);

  var isArm = (SESSION.targetLimb === 'arm' || SESSION.targetLimb === 'weightlifting');

  // Zoom logic
  var zoom = SESSION.anatomyZoom || 1.0;
  if (zoom > 1.0) {
    var cx = 110, cy = 150;
    var active = SESSION.activeChannels || [1];
    if (isArm) {
      cx = 100; cy = 130;
    } else {
      if (active.indexOf(3) !== -1) { cx = 120; cy = 220; }
      else if (active.indexOf(1) !== -1 || active.indexOf(2) !== -1) { cx = 115; cy = 105; }
    }
    actx.translate(w / 2, h / 2);
    actx.scale(zoom, zoom);
    actx.translate(-cx, -cy);
  }

  actx.clearRect(0, 0, w, h);

  // Background grid
  actx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
  actx.lineWidth = 1;
  for (var x = -100; x < w + 200; x += 20) {
    actx.beginPath(); actx.moveTo(x, -100); actx.lineTo(x, h + 200); actx.stroke();
  }
  for (var y = -100; y < h + 200; y += 20) {
    actx.beginPath(); actx.moveTo(-100, y); actx.lineTo(w + 200, y); actx.stroke();
  }

  // Leg outline
  var legPoints = [
    {x: 120, y: 25}, {x: 95,  y: 125}, {x: 102, y: 175},
    {x: 95,  y: 265}, {x: 102, y: 285}, {x: 80,  y: 295},
    {x: 55,  y: 305}, {x: 55,  y: 310}, {x: 108, y: 310},
    {x: 118, y: 295}, {x: 132, y: 235}, {x: 122, y: 175},
    {x: 142, y: 105}, {x: 145, y: 45}
  ];

  // Arm outline
  var armPoints = [
    {x: 75,  y: 25}, {x: 110, y: 75}, {x: 115, y: 125},
    {x: 95,  y: 180}, {x: 82,  y: 235}, {x: 65,  y: 255},
    {x: 55,  y: 265}, {x: 65,  y: 275}, {x: 92,  y: 240},
    {x: 118, y: 180}, {x: 130, y: 135}, {x: 122, y: 75},
    {x: 100, y: 25}
  ];

  var points = isArm ? armPoints : legPoints;

  // Draw silhouette
  actx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  actx.lineWidth = 3;
  actx.lineCap = 'round';
  actx.lineJoin = 'round';
  actx.beginPath();
  actx.moveTo(points[0].x, points[0].y);
  for (var i = 1; i < points.length; i++) {
    actx.lineTo(points[i].x, points[i].y);
  }
  actx.closePath();
  actx.stroke();

  actx.fillStyle = 'rgba(255, 255, 255, 0.02)';
  actx.fill();

  // Draw joints
  actx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  if (isArm) {
    actx.beginPath(); actx.arc(88, 30, 1.8, 0, Math.PI * 2); actx.fill();
    actx.beginPath(); actx.arc(122, 130, 1.8, 0, Math.PI * 2); actx.fill();
    actx.beginPath(); actx.arc(87, 237, 1.2, 0, Math.PI * 2); actx.fill();
  } else {
    actx.beginPath(); actx.arc(112, 175, 1.8, 0, Math.PI * 2); actx.fill();
    actx.beginPath(); actx.arc(108, 290, 1.2, 0, Math.PI * 2); actx.fill();
  }

  // Muscles definitions
  var legMuscles = [
    {
      ch: 1, name: 'Rectus Femoris',
      cx: 111, cy: 100, rx: 14, ry: 33, rot: 0.12,
      color: '#00e5c8', colorRGB: '0, 229, 200',
      desc: 'To activate the <b>Rectus Femoris (Front Thigh)</b>:<br/>• Straighten your knee or push leg upward.<br/>• Squat down and rise up under load.'
    },
    {
      ch: 2, name: 'Biceps Femoris',
      cx: 131, cy: 110, rx: 12, ry: 28, rot: 0.14,
      color: '#ffb300', colorRGB: '255, 179, 0',
      desc: 'To activate the <b>Biceps Femoris (Back Thigh)</b>:<br/>• Bend your knee or pull your heel backward.<br/>• Resist extension of the leg.'
    },
    {
      ch: 3, name: 'Gastrocnemius',
      cx: 124, cy: 225, rx: 11, ry: 24, rot: -0.10,
      color: '#9d4edd', colorRGB: '157, 78, 221',
      desc: 'To activate the <b>Gastrocnemius (Calf)</b>:<br/>• Point your toes down (plantar flexion).<br/>• Raise your heels off the ground.'
    },
    {
      ch: 4, name: 'Spare Muscle',
      cx: 107, cy: 230, rx: 8, ry: 22, rot: 0.05,
      color: '#ff357a', colorRGB: '255, 53, 122',
      desc: 'To activate the <b>Auxiliary Target Muscle</b>:<br/>• Contract the secondary targeted muscle group.<br/>• Ensure correct electrode placement.'
    }
  ];

  var armMuscles = [
    {
      ch: 1, name: 'Biceps Brachii',
      cx: 112, cy: 95, rx: 11, ry: 25, rot: 0.15,
      color: '#00e5c8', colorRGB: '0, 229, 200',
      desc: 'To activate the <b>Biceps Brachii (Front Upper Arm)</b>:<br/>• Bend your elbow or curl a weight.<br/>• Rotate your forearm so your palm faces up.'
    },
    {
      ch: 2, name: 'Triceps Brachii',
      cx: 124, cy: 95, rx: 10, ry: 26, rot: -0.15,
      color: '#ffb300', colorRGB: '255, 179, 0',
      desc: 'To activate the <b>Triceps Brachii (Back Upper Arm)</b>:<br/>• Straighten your elbow (push down or back).<br/>• Extend your arm backwards.'
    },
    {
      ch: 3, name: 'Brachioradialis',
      cx: 108, cy: 175, rx: 9, ry: 22, rot: 0.12,
      color: '#9d4edd', colorRGB: '157, 78, 221',
      desc: 'To activate the <b>Brachioradialis (Forearm Extensor)</b>:<br/>• Flex your elbow with your thumb pointing upwards.<br/>• Squeeze your grip or raise your wrist.'
    },
    {
      ch: 4, name: 'Flexor Carpi',
      cx: 95, cy: 185, rx: 8, ry: 22, rot: -0.22,
      color: '#ff357a', colorRGB: '255, 53, 122',
      desc: 'To activate the <b>Flexor Carpi (Wrist Flexor)</b>:<br/>• Bend your wrist inward (palm toward forearm).<br/>• Make a tight fist or squeeze your fingers.'
    }
  ];

  var muscles = isArm ? armMuscles : legMuscles;
  var activeChs = SESSION.activeChannels || [1];
  var isAuto = activeChs.length === 1 && activeChs[0] === 0;

  var pulse = Math.sin(Date.now() / 220) * 0.22 + 0.68;
  var guideHtml = '<h4>Muscle Activation Guide</h4>';
  var activeDescriptions = [];

  muscles.forEach(function(m) {
    var isActive = isAuto || activeChs.indexOf(m.ch) !== -1;
    if (isActive) {
      actx.save();
      actx.shadowColor = m.color;
      actx.shadowBlur = 14 * pulse;
      actx.fillStyle = 'rgba(' + m.colorRGB + ', ' + (0.32 * pulse) + ')';
      actx.strokeStyle = m.color;
      actx.lineWidth = 1.8;
      
      actx.beginPath();
      actx.ellipse(m.cx, m.cy, m.rx, m.ry, m.rot, 0, Math.PI * 2);
      actx.fill();
      actx.stroke();

      // Dashed connector
      actx.strokeStyle = 'rgba(' + m.colorRGB + ', 0.65)';
      actx.lineWidth = 1;
      actx.setLineDash([2, 2]);
      actx.beginPath();
      actx.moveTo(m.cx, m.cy);
      
      var lx = m.cx > 115 ? w - 35 : 35;
      var ly = m.cy - 12;
      actx.lineTo(lx, ly);
      actx.stroke();
      actx.setLineDash([]);
      
      // Labels
      actx.shadowBlur = 0;
      actx.fillStyle = m.color;
      actx.font = 'bold 9px Orbitron';
      actx.textAlign = m.cx > 115 ? 'right' : 'left';
      actx.fillText('CH' + m.ch, lx, ly - 4);
      actx.fillStyle = '#ffffff';
      actx.font = '7.5px Inter';
      actx.fillText(m.name.toUpperCase(), lx, ly + 6);

      actx.restore();

      activeDescriptions.push(m.desc);
    }
  });

  var guideBox = $('guide-box');
  if (guideBox && activeDescriptions.length > 0) {
    guideHtml += activeDescriptions.join('<br/><hr style="border:none;border-top:1px solid rgba(255,255,255,0.06);margin:8px 0;"/>');
    if (activeChs.length > 1) {
      guideHtml += '<br/><span style="color:#ffb300;font-size:10.5px;display:block;margin-top:6px;line-height:1.4;">⚠️ <b>Multi-Muscle Constraint:</b> In Min RMS mode, all selected muscles must cross threshold together to trigger jump.</span>';
    }
    if (guideBox.innerHTML !== guideHtml) {
      guideBox.innerHTML = guideHtml;
    }
  }
}

// ── Static Background Preview ─────────────────────────
function staticBg() {
  if (rafId) return;
  
  if (W === 0 || H === 0) {
    requestAnimationFrame(staticBg);
    return;
  }
  
  ctx.clearRect(0, 0, W, H);

  var bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#02040a');
  bg.addColorStop(1, '#040818');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Draw 10 preview hurdles
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

  updateAnatomyCanvas();

  requestAnimationFrame(staticBg);
}
