'use strict';

/* ═══════════════════════════════════════════════════════
   MyoHurdle Protocol — game-logic.js
   ─────────────────────────────────────────────────────
   Main state machine loops, update calculations, calibration,
   and file export utilities.
   ═══════════════════════════════════════════════════════ */

// ── Game Loop Ticker ──────────────────────────────────
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
  rafId = requestAnimationFrame(gameLoop);
}

// ── State Machine Update ──────────────────────────────
function update(dt) {
  if (GAME.phase === 'approaching') {
    updateApproach(dt);
  } else if (GAME.phase === 'resting') {
    updateResting(dt);
  } else if (GAME.phase === 'ready') {
    updateReady(dt);
  } else if (GAME.phase === 'at_hurdle') {
    updateAtHurdle(dt);
  } else if (GAME.phase === 'jumping') {
    updateJump(dt);
  } else if (GAME.phase === 'hit') {
    updateHit(dt);
  }
}

// ── Update: Approaching (run to hurdle) ───────────────
function updateApproach(dt) {
  // Check for early flex
  if (EMG.rms >= SESSION.threshold) {
    earlyFlexHeld += dt;
    if (earlyFlexHeld >= 0.12) {
      beginRestPhase(true);
      return;
    }
  } else {
    earlyFlexHeld = 0;
  }

  GAME.approachT += dt;
  var t = Math.min(GAME.approachT / GAME.approachDur, 1);
  t = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // Ease in-out

  GAME.charFrac = lerp(GAME.approachStartFrac, GAME.approachTargetFrac, t);

  if (GAME.approachT >= GAME.approachDur) {
    beginAtHurdle();
  }
}

// ── Update: Resting (relax forearm/leg muscle) ────────
function updateResting(dt) {
  var relaxThreshold = Math.max(SESSION.baseline + 8, SESSION.threshold * 0.4, 15);
  // Cap relax threshold at 75% of target flex threshold so relaxed < jump trigger is always true
  relaxThreshold = Math.min(relaxThreshold, SESSION.threshold * 0.75);
  var currentRms = Math.round(EMG.rms);

  if (GAME.restTimer > 0) {
    // Mandatory rest countdown — player cannot do anything yet
    GAME.restTimer -= dt;
    GAME.relaxTimeHeld = 0; // Cannot start counting relaxation until mandatory rest is done
    $('cd-big').textContent = Math.ceil(GAME.restTimer) + ' s';
    if (restTooEarly) {
      $('cd-sub').textContent = '⚠️ TOO EARLY! RELAX YOUR MUSCLE';
      $('cd-sub').style.color = '#ff3860';
    } else {
      $('cd-sub').textContent = '🧘 REST & RELAX YOUR MUSCLE';
      $('cd-sub').style.color = '#ffb300';
    }
  } else {
    $('cd-big').textContent = currentRms + ' mV';
    if (restTooEarly) {
      $('cd-sub').textContent = '⚠️ RELAX YOUR MUSCLE (Target: <' + Math.round(relaxThreshold) + ' mV)';
      $('cd-sub').style.color = '#ff3860';
    } else {
      $('cd-sub').textContent = '🧘 RELAX YOUR MUSCLE (Target: <' + Math.round(relaxThreshold) + ' mV)';
      $('cd-sub').style.color = '#ffb300';
    }

    // Must sustain relaxation for at least 200ms continuously
    if (EMG.rms < relaxThreshold) {
      GAME.relaxTimeHeld += dt;
      if (GAME.relaxTimeHeld >= 0.20) {
        beginReadyPhase();
      }
    } else {
      GAME.relaxTimeHeld = 0; // Any spike resets the relaxation hold
    }
  }
}

// ── Update: Ready countdown phase (1s) ────────────────
function updateReady(dt) {
  // Check for early flex
  if (EMG.rms >= SESSION.threshold) {
    earlyFlexHeld += dt;
    if (earlyFlexHeld >= 0.12) {
      beginRestPhase(true);
      return;
    }
  } else {
    earlyFlexHeld = 0;
  }

  GAME.readyTimer -= dt;
  $('cd-big').textContent = Math.max(0, Math.ceil(GAME.readyTimer));

  if (GAME.readyTimer <= 0) {
    hideOverlay('cd-overlay');
    $('cd-sub').style.color = '';
    beginApproach(GAME.currentHurdle);
  }
}

// ── Update: At-Hurdle ─────────────────────────────────
function updateAtHurdle(dt) {
  if (EMG.rms > GAME.currentPeakEMG) {
    GAME.currentPeakEMG = EMG.rms;
    $('fs-peak').textContent = Math.round(GAME.currentPeakEMG) + ' mV';
  }

  updatePowerBar();

  // Noise prevention hold threshold check
  if (EMG.rms >= SESSION.threshold) {
    flexThresholdHeld += dt;
    if (flexThresholdHeld >= 0.12) {
      triggerJump();
      return;
    }
  } else {
    flexThresholdHeld = 0;
  }

  flexTimer -= dt;
  updateCountdownRing(flexTimer / SESSION.attemptTimeLimit);
  $('cd-arc-num').textContent = Math.max(0, flexTimer).toFixed(1);

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
  var rms = EMG.rms;
  var thr = SESSION.threshold;
  var pct = Math.min(rms / 300 * 100, 100);
  var fill = $('power-bar-fill');
  if (!fill) return;

  fill.style.width = pct + '%';
  fill.className = 'power-bar-fill';

  var ratio = rms / thr;
  if (ratio >= 1.0) {
    fill.classList.add('hit');
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

// ── Update: Jumping ───────────────────────────────────
function updateJump(dt) {
  var grav = 1900;
  GAME.charVy += grav * dt;
  GAME.charY += GAME.charVy * dt;
  GAME.charFrac += 0.7 * dt * (1 / (SESSION.numHurdles + 1));

  if (GAME.charY >= 0) {
    GAME.charY = 0;
    GAME.charVy = 0;
    onLanded();
  }
}

// ── Update: Hit / Crash ───────────────────────
function updateHit(dt) {
  GAME.hitTimer -= dt;
  if (GAME.hitTimer <= 0) {
    // After a failed attempt, put the player back in the rest phase
    // to ensure they relax before trying again (prevents auto-passing)
    var prevFrac = hurdleFrac(GAME.currentHurdle) - 0.15;
    GAME.charFrac = Math.max(0, prevFrac);
    beginRestPhase(false);
  }
}

// ── State Transition Triggers ─────────────────────────
function beginApproach(hurdleIndex) {
  GAME.phase = 'approaching';
  GAME.approachT = 0;
  GAME.approachStartFrac = GAME.charFrac;
  GAME.approachTargetFrac = hurdleFrac(hurdleIndex) - 0.018;
  GAME.approachTargetFrac = Math.max(GAME.charFrac, GAME.approachTargetFrac);
  earlyFlexHeld = 0;

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

  var attempt = makeAttemptRecord('success');
  HURDLE_LOG[GAME.currentHurdle].attempts.push(attempt);

  hideFlexOverlay();

  var hx = W * TRACK_L_FRAC + W * (TRACK_R_FRAC - TRACK_L_FRAC) * hurdleFrac(GAME.currentHurdle);
  var ty = H * TRACK_Y_FRAC;
  addParticles(hx, ty - hurdleVisualH() / 2, '#00c97a', 18, 1.2);

  flashScreen('green');
}

function triggerHit() {
  GAME.phase = 'hit';
  GAME.hitTimer = 1.2;
  flexThresholdHeld = 0;

  var attempt = makeAttemptRecord('fail');
  HURDLE_LOG[GAME.currentHurdle].attempts.push(attempt);

  hideFlexOverlay();

  shake.t = 0.35;
  shake.mag = 10;

  var hx = W * TRACK_L_FRAC + W * (TRACK_R_FRAC - TRACK_L_FRAC) * hurdleFrac(GAME.currentHurdle);
  var ty = H * TRACK_Y_FRAC;
  addParticles(hx, ty - 20, '#ff3860', 12, 0.9);

  flashScreen('red');
}

function onLanded() {
  if (HURDLE_LOG[GAME.currentHurdle]) {
    HURDLE_LOG[GAME.currentHurdle].completedAt = Date.now() - sessionStartTime;
  }

  GAME.currentHurdle++;
  GAME.totalAttemptsThisHurdle = 0;

  if (GAME.currentHurdle >= SESSION.numHurdles) {
    GAME.phase = 'complete';
    setTimeout(completeSession, 900);
  } else {
    beginRestPhase(false);
  }
}

function beginRestPhase(tooEarly) {
  GAME.phase = 'resting';
  GAME.restTimer = 2.0;    // Guaranteed minimum rest (2s)
  GAME.relaxTimeHeld = 0;  // Always reset on rest entry
  earlyFlexHeld = 0;       // Reset early flex timer
  restTooEarly = !!tooEarly;
  showOverlay('cd-overlay');

  if (restInterval) {
    clearInterval(restInterval);
    restInterval = null;
  }

  $('cd-big').textContent = '2 s';
  if (tooEarly) {
    $('cd-sub').textContent = '⚠️ TOO EARLY! RELAX YOUR MUSCLE';
    $('cd-sub').style.color = '#ff3860';
  } else {
    $('cd-sub').textContent = '🧘 REST & RELAX YOUR MUSCLE';
    $('cd-sub').style.color = '#ffb300';
  }
}

function beginReadyPhase() {
  GAME.phase = 'ready';
  GAME.readyTimer = 1.0; // Ready countdown timer
  earlyFlexHeld = 0;      // Reset early flex timer
  restTooEarly = false;   // Reset warning state

  $('cd-big').textContent = '1';
  if (GAME.currentHurdle === 0) {
    $('cd-sub').textContent = 'GET READY FOR HURDLE 1';
  } else {
    $('cd-sub').textContent = 'GET READY FOR NEXT HURDLE';
  }
  $('cd-sub').style.color = '#00e5c8';
}

function resetToSetup() {
  if (restInterval) {
    clearInterval(restInterval);
    restInterval = null;
  }
  if (calibInterval) {
    clearInterval(calibInterval);
    calibInterval = null;
  }

  // Wipe session data caches
  if (typeof EmgEngine !== 'undefined') {
    EmgEngine.clearAllData();
  }

  GAME.relaxTimeHeld = 0;
  earlyFlexHeld = 0;
  restTooEarly = false;
  hideAllOverlays();
  SESSION.calibrated = false;
  $('start-btn').disabled = true;
  $('calib-result-badge').classList.add('hidden');
  showOverlay('setup-overlay');
  updateCachedDimensions();
}

// ── Overlay management helper ────────────────────────
function showOverlay(id) {
  ALL_OVERLAYS.forEach(function (oid) {
    var el = $(oid);
    if (el) el.classList.toggle('hidden', oid !== id);
  });
  updateCachedDimensions();
}

function hideOverlay(id) {
  var el = $(id);
  if (el) el.classList.add('hidden');
}

function hideAllOverlays() {
  ALL_OVERLAYS.forEach(function (id) {
    var el = $(id);
    if (el) el.classList.add('hidden');
  });
}

// ── Flex Panel UI update ─────────────────────────────
function showFlexOverlay() {
  $('flex-overlay').classList.remove('hidden');
  updateCachedDimensions();

  $('flex-hurdle-id').textContent = 'HURDLE ' + (GAME.currentHurdle + 1) + ' / ' + SESSION.numHurdles;
  $('flex-attempt-badge').textContent = 'ATTEMPT ' + GAME.totalAttemptsThisHurdle;
  $('power-lbl-right').textContent = 'TARGET (' + Math.round(SESSION.threshold) + ' mV)';
  $('fs-target').textContent = Math.round(SESSION.threshold) + ' mV';
  $('fs-attempts').textContent = GAME.totalAttemptsThisHurdle;
  $('fs-peak').textContent = '0 mV';
  $('fs-channel').textContent = 'CH' + EMG.channel;
  $('power-rms-display').textContent = '0 mV';
  $('power-instruct').textContent = 'FLEX YOUR FOREARM TO JUMP';
  $('power-instruct').className = 'power-instruct';

  var tPct = Math.min(SESSION.threshold / 300 * 100, 96);
  $('power-thr-line').style.left = tPct + '%';

  updateCountdownRing(1);
  $('cd-arc').setAttribute('stroke', '#00e5c8');
  $('cd-arc-num').textContent = SESSION.attemptTimeLimit.toFixed(1);
  $('power-bar-fill').style.width = '0%';
  $('power-bar-fill').className = 'power-bar-fill';
}

function hideFlexOverlay() {
  $('flex-overlay').classList.add('hidden');
}

// ── Calibration implementation ───────────────────────
var calibSamples = [];
var calibBase = 0;
var calibPhase = 'idle'; // idle | relax | flex

function startSampleFlex() {
  calibPhase = 'relax';
  calibSamples = [];
  calibElapsed = 0;
  calibBase = 0;

  showOverlay('calib-overlay');
  $('calib-phase-label').textContent = 'PHASE 1 / 2 — BASELINE';
  $('calib-instr').textContent = '🧘 Relax your forearm completely…';
  $('calib-count').textContent = '3';
  $('calib-note').textContent = 'Recording resting baseline…';

  $('setup-live-wrap').classList.remove('hidden');
  startLoop();

  if (calibInterval) clearInterval(calibInterval);
  calibInterval = setInterval(tickCalib, 80);
}

function tickCalib() {
  calibElapsed += 0.08;
  var rms = EMG.rms;
  calibSamples.push(rms);

  var pct = Math.min(rms / 300 * 100, 100);
  $('calib-bar-fg').style.width = pct + '%';
  $('calib-bar-rms').textContent = Math.round(rms) + ' mV';
  $('setup-live-fg').style.width = pct + '%';
  $('setup-live-rms').textContent = Math.round(rms) + ' mV';

  var total = calibPhase === 'relax' ? 3 : 3.5;
  var rem = Math.max(0, Math.ceil(total - calibElapsed));
  $('calib-count').textContent = rem;

  if (calibElapsed >= total) {
    if (calibPhase === 'relax') {
      calibBase = calibSamples.reduce(function (s, v) { return s + v; }, 0) / calibSamples.length;
      SESSION.baseline = calibBase;
      calibSamples = [];
      calibElapsed = 0;
      calibPhase = 'flex';

      $('calib-phase-label').textContent = 'PHASE 2 / 2 — TARGET FLEX';
      $('calib-instr').textContent = '💪 Flex at your DESIRED effort level and hold it!';
      $('calib-count').textContent = '3';
      $('calib-note').textContent = 'Recording your target strength…';
    } else {
      var peakFlex = Math.max.apply(null, calibSamples);
      SESSION.threshold = Math.max(calibBase + 5, peakFlex * 0.85);
      SESSION.calibrated = true;

      if (calibInterval) {
        clearInterval(calibInterval);
        calibInterval = null;
      }
      calibPhase = 'idle';

      showOverlay('setup-overlay');

      $('calib-result-badge').classList.remove('hidden');
      $('calib-result-mV').textContent = Math.round(SESSION.threshold) + ' mV';
      $('start-btn').disabled = false;
    }
  }
}

function skipCalib() {
  if (calibInterval) {
    clearInterval(calibInterval);
    calibInterval = null;
  }
  // Stop any animation loop started by startSampleFlex
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  calibPhase = 'idle';
  SESSION.threshold = 30;
  SESSION.baseline = 4;
  SESSION.calibrated = true;

  showOverlay('setup-overlay');
  $('calib-result-badge').classList.remove('hidden');
  $('calib-result-mV').textContent = '30 mV (default)';
  $('start-btn').disabled = false;
}

// ── Session start / execution ────────────────────────
function startProtocol() {
  var meta = readGameSessionMeta();
  SESSION.participantName = meta.participant;
  SESSION.sex = meta.sex;
  SESSION.age = meta.age;
  SESSION.weight_kg = meta.weight_kg;
  SESSION.height_cm = meta.height_cm;
  SESSION.exercise = meta.exercise;
  SESSION.trial_no = meta.trial_no;
  SESSION.targetLimb = meta.targetLimb;
  SESSION.numHurdles = parseInt($('inp-hurdles').value);
  SESSION.attemptTimeLimit = parseInt($('inp-timelimit').value);

  var ts = new Date();
  SESSION.sessionId = 'MH_' +
    ts.getFullYear() +
    pad2(ts.getMonth() + 1) +
    pad2(ts.getDate()) + '_' +
    pad2(ts.getHours()) +
    pad2(ts.getMinutes()) + '_' +
    Math.floor(Math.random() * 900 + 100);

  GAME.phase = 'setup';
  GAME.currentHurdle = 0;
  GAME.charFrac = 0;
  GAME.charY = 0;
  GAME.charVy = 0;
  GAME.charAnimT = 0;
  GAME.totalAttemptsThisHurdle = 0;
  HURDLE_LOG.length = 0;
  particles.length = 0;
  waveHistories = { 1: [], 2: [], 3: [], 4: [] };
  waveHistoryCombined = [];

  // Clear data cache on new trial
  if (typeof EmgEngine !== 'undefined') {
    EmgEngine.clearAllData();
  }

  hideOverlay('setup-overlay');

  // Start session recording and start directly with the rest phase
  sessionStartTime = Date.now();
  startGameEMGRecording();
  GAME.charFrac = 0;
  beginRestPhase(false);
  startLoop();
}

function completeSession() {
  GAME.phase = 'results';
  stopGameEMGRecording();
  buildResults();
  showOverlay('results-overlay');
}

// ── Results View & File Exports ──────────────────────
function buildResults() {
  var totalAttempts = HURDLE_LOG.reduce(function (s, h) { return s + (h ? h.attempts.length : 0); }, 0);
  var totalTime = (Date.now() - sessionStartTime) / 1000;
  var efficiency = ((SESSION.numHurdles / Math.max(totalAttempts, 1)) * 100).toFixed(1);

  var peaks = HURDLE_LOG.map(function (h) {
    if (!h) return 0;
    var s = h.attempts.find(function (a) { return a.outcome === 'success'; });
    return s ? s.peakEMG_mV : 0;
  });
  var avgPeak = peaks.length > 0
    ? peaks.reduce(function (s, v) { return s + v; }, 0) / peaks.length
    : 0;

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

  var tbody = $('results-tbody');
  tbody.innerHTML = '';
  for (var i = 0; i < SESSION.numHurdles; i++) {
    var h = HURDLE_LOG[i];
    if (!h) continue;
    var nattempts = h.attempts.length;
    var success = h.attempts.find(function (a) { return a.outcome === 'success'; });
    var peakEMG = success ? Math.round(success.peakEMG_mV) : '—';
    var timeToAct = success && success.timeToThreshold_ms != null
      ? Math.round(success.timeToThreshold_ms) : '—';
    var clearedAt = h.completedAt ? (h.completedAt / 1000).toFixed(1) + 's' : '—';
    var effTxt = nattempts === 1 ? '✓ First try' : nattempts + ' attempts';
    var effCls = nattempts === 1 ? 'good' : nattempts > 3 ? 'warn' : '';

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

function makeAttemptRecord(outcome) {
  var now = Date.now();
  var duration = now - GAME.currentAttemptStart;
  var trace = waveHistoryCombined.slice();
  var meanEMG = 0;
  if (trace.length) {
    meanEMG = trace.reduce(function (s, v) { return s + v; }, 0) / trace.length;
  }
  return {
    startTime_ms: GAME.currentAttemptStart - sessionStartTime,
    endTime_ms: now - sessionStartTime,
    duration_ms: duration,
    outcome: outcome,
    peakEMG_mV: round2(GAME.currentPeakEMG),
    meanEMG_mV: round2(meanEMG),
    timeToThreshold_ms: outcome === 'success' ? duration : null,
    channel: EMG.channel,
    threshold_mV: round2(SESSION.threshold),
    baseline_mV: round2(SESSION.baseline),
    emg_trace_hz: trace.length && duration > 0
      ? round2(trace.length / (duration / 1000))
      : null,
    emg_trace_mV: trace,
  };
}

function exportJSON() {
  var totalAttempts = HURDLE_LOG.reduce(function (s, h) { return s + (h ? h.attempts.length : 0); }, 0);
  var totalTime = (Date.now() - sessionStartTime) / 1000;

  var data = {
    schema_version: '2.0',
    sessionId: SESSION.sessionId,
    timestamp: new Date().toISOString(),
    participant: {
      id: SESSION.participantName || 'anonymous',
      sex: SESSION.sex,
      age: SESSION.age,
      weight_kg: SESSION.weight_kg,
      height_cm: SESSION.height_cm,
    },
    protocol: {
      exercise: SESSION.exercise,
      trial_no: SESSION.trial_no,
      numHurdles: SESSION.numHurdles,
      attemptTimeLimit_s: SESSION.attemptTimeLimit,
      threshold_mV: round2(SESSION.threshold),
      baseline_mV: round2(SESSION.baseline),
      hurdleVisualH_px: Math.round(hurdleVisualH()),
    },
    emg_recording: {
      sample_count: EmgEngine.recorder ? EmgEngine.recorder.sampleCount : 0,
      session_timestamp: EmgEngine.recorder ? EmgEngine.recorder.getMeta().session_timestamp : null,
    },
    summary: {
      totalAttempts: totalAttempts,
      totalTime_s: round2(totalTime),
      efficiency_pct: round2((SESSION.numHurdles / Math.max(totalAttempts, 1)) * 100),
    },
    hurdles: HURDLE_LOG.map(function (h, i) {
      if (!h) return null;
      return {
        hurdle: i + 1,
        totalAttempts: h.attempts.length,
        completedAt_ms: h.completedAt,
        attempts: h.attempts.map(function (a, idx) {
          return {
            attempt_no: idx + 1,
            outcome: a.outcome,
            startTime_ms: a.startTime_ms,
            endTime_ms: a.endTime_ms,
            duration_ms: a.duration_ms,
            peakEMG_mV: a.peakEMG_mV,
            meanEMG_mV: a.meanEMG_mV,
            timeToThreshold_ms: a.timeToThreshold_ms,
            channel: a.channel,
            threshold_mV: a.threshold_mV,
            baseline_mV: a.baseline_mV,
            emg_trace_hz: a.emg_trace_hz,
            emg_trace_mV: a.emg_trace_mV,
          };
        }),
      };
    }).filter(Boolean),
  };

  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
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

  HURDLE_LOG.forEach(function (h, hi) {
    if (!h) return;
    h.attempts.forEach(function (a, ai) {
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

// ── Web Serial integration and packets parser ────────
function readGameSessionMeta() {
  return {
    participant: $('inp-name').value.trim() || 'P001',
    sex: $('inp-sex').value || 'male',
    age: parseInt($('inp-age').value, 10) || 25,
    weight_kg: parseFloat($('inp-weight').value) || 70,
    height_cm: parseFloat($('inp-height').value) || 170,
    exercise: $('inp-exercise').value || 'leg_press',
    trial_no: parseInt($('inp-trial').value, 10) || 1,
    label: $('inp-exercise').value || 'leg_press',
    targetLimb: $('inp-limb').value || 'leg',
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

function connectEMG() {
  window.addEventListener('emg-update', onEmgUpdate);

  if (typeof SerialWeb !== 'undefined' && SerialWeb.isSupported()) {
    SerialWeb.reconnectGranted(921600).then(function (ok) {
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

  lastEmgMsg = msg; // Render wave graphs

  var live = msg.channels.filter(function (c) { return (c.sample_rate || 0) > 0; });
  var pool = live.length > 0 ? live : msg.channels;

  var activeChs = SESSION.activeChannels || [1];
  if (activeChs.length === 1 && activeChs[0] === 0) {
    var chosen = pool.reduce(function (b, c) { return (c.rms || 0) > (b.rms || 0) ? c : b; }, pool[0]);
    EMG.rms = chosen.rms || 0;
    EMG.channel = chosen.ch || '?';
  } else {
    var targetChannels = msg.channels.filter(function (c) { return activeChs.indexOf(c.ch) !== -1; });
    if (targetChannels.length === 0) {
      targetChannels = [pool[0]];
    }

    var rmsValues = targetChannels.map(function (c) { return c.rms || 0; });
    var combVal = 0;
    if (SESSION.combMode === 'max') {
      combVal = Math.max.apply(null, rmsValues);
    } else if (SESSION.combMode === 'min') {
      combVal = Math.min.apply(null, rmsValues);
    } else {
      var sum = rmsValues.reduce(function (a, b) { return a + b; }, 0);
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

  var preview = $('ch-live-preview');
  if (preview) {
    var rmsVal = Math.round(EMG.rms);
    var label = activeChs.map(function (c) { return c === 0 ? 'AUTO' : 'CH' + c; }).join('+');
    if (activeChs.length > 1) {
      label += ' (' + SESSION.combMode.toUpperCase() + ')';
    }
    preview.textContent = 'Live RMS: ' + rmsVal + ' mV  [' + label + ']';
    preview.style.color = rmsVal > 50 ? '#00e5a0' : '#8b949e';
  }
  updateAnatomyCanvas();
}
