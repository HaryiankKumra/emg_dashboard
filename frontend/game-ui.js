'use strict';

/* ═══════════════════════════════════════════════════════
   MyoHurdle Protocol — game-ui.js
   ─────────────────────────────────────────────────────
   Event bindings, setup panel form controls, channel triggers,
   anatomy canvas interactions, and boot actions.
   ═══════════════════════════════════════════════════════ */

function initSetupForm() {
  // Number of hurdles slider
  var hurdlesInp = $('inp-hurdles');
  if (hurdlesInp) {
    hurdlesInp.addEventListener('input', function () {
      SESSION.numHurdles = parseInt(this.value);
      $('hurdles-val').textContent = this.value;
    });
  }

  // Attempt time limit slider
  var timeInp = $('inp-timelimit');
  if (timeInp) {
    timeInp.addEventListener('input', function () {
      SESSION.attemptTimeLimit = parseInt(this.value);
      $('timelimit-val').textContent = this.value + ' s';
    });
  }

  // Channel buttons
  var chBtns = document.querySelectorAll('.channel-picker .ch-btn');
  chBtns.forEach(function (btn) {
    // Skip zoom button
    if (btn.id === 'anatomy-zoom-btn') return;

    btn.addEventListener('click', function () {
      var ch = parseInt(this.getAttribute('data-ch'));
      if (!SESSION.activeChannels) SESSION.activeChannels = [1];

      if (ch === 0) {
        // Auto mode
        SESSION.activeChannels = [0];
        chBtns.forEach(function (b) {
          if (b.id === 'anatomy-zoom-btn') return;
          if (parseInt(b.getAttribute('data-ch')) === 0) b.classList.add('active');
          else b.classList.remove('active');
        });
      } else {
        // Specific channel mode
        var index0 = SESSION.activeChannels.indexOf(0);
        if (index0 !== -1) SESSION.activeChannels.splice(index0, 1);
        var autoBtn = $('ch-btn-0');
        if (autoBtn) autoBtn.classList.remove('active');

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

      // Multi-muscle select visibility
      var combRow = $('comb-mode-row');
      if (combRow) {
        combRow.style.display = SESSION.activeChannels.length > 1 ? 'block' : 'none';
      }

      SESSION.activeChannels.sort(function (a, b) { return a - b; });

      var label = SESSION.activeChannels.map(function (c) { return c === 0 ? 'AUTO' : 'CH' + c; }).join('+');
      var preview = $('ch-live-preview');
      if (preview) preview.textContent = 'Live RMS: — mV  [' + label + ' selected]';
      updateAnatomyCanvas();
    });
  });

  // Combination mode change
  var combModeSelect = $('inp-comb-mode');
  if (combModeSelect) {
    combModeSelect.addEventListener('change', function () {
      SESSION.combMode = this.value;
    });
  }

  // Limb options selector
  var limbSelect = $('inp-limb');
  if (limbSelect) {
    limbSelect.addEventListener('change', function () {
      var limb = this.value;
      SESSION.targetLimb = limb;
      updateExerciseOptions(limb);
      updateChannelLabels(limb);
      updateAnatomyCanvas();
    });
    // Init exercise options
    updateExerciseOptions(limbSelect.value);
    updateChannelLabels(limbSelect.value);
  }

  // Add Custom Exercise button listener
  var addExBtn = $('add-exercise-btn');
  if (addExBtn) {
    addExBtn.addEventListener('click', function () {
      var customName = prompt("Enter name of custom exercise:");
      if (customName) {
        customName = customName.trim();
        if (customName.length > 0) {
          var value = customName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
          if (!LIMB_EXERCISES[SESSION.targetLimb]) {
            LIMB_EXERCISES[SESSION.targetLimb] = [];
          }
          // Mark others as not selected
          LIMB_EXERCISES[SESSION.targetLimb].forEach(function (o) { o.selected = false; });

          // Add new custom option
          LIMB_EXERCISES[SESSION.targetLimb].push({
            value: value,
            label: customName,
            selected: true
          });

          // Re-populate and select it
          updateExerciseOptions(SESSION.targetLimb);

          // Force select tag to match value
          var select = $('inp-exercise');
          if (select) select.value = value;

          // Update exercise in session
          SESSION.exercise = value;
        }
      }
    });
  }

  // Anatomy Zoom Button
  var zoomBtn = $('anatomy-zoom-btn');
  if (zoomBtn) {
    zoomBtn.addEventListener('click', function () {
      SESSION.anatomyZoom = (SESSION.anatomyZoom === 1.0) ? 1.6 : 1.0;
      this.textContent = (SESSION.anatomyZoom === 1.0) ? '🔍 Zoom' : '🔍 Zoom Out';
      updateAnatomyCanvas();
    });
  }

  // Action Buttons
  var sampleFlexBtn = $('calib-sample-btn');
  if (sampleFlexBtn) sampleFlexBtn.addEventListener('click', startSampleFlex);

  var skipCalibBtn = $('skip-calib-btn');
  if (skipCalibBtn) skipCalibBtn.addEventListener('click', skipCalib);

  var startBtn = $('start-btn');
  if (startBtn) startBtn.addEventListener('click', startProtocol);

  var exportBtn = $('export-btn');
  if (exportBtn) exportBtn.addEventListener('click', exportJSON);

  var exportAttemptsBtn = $('export-attempts-btn');
  if (exportAttemptsBtn) exportAttemptsBtn.addEventListener('click', exportAttemptsCSV);

  var exportFiltBtn = $('export-emg-filtered-btn');
  if (exportFiltBtn) exportFiltBtn.addEventListener('click', function () { exportGameEMGCSV(true); });

  var exportRawBtn = $('export-emg-raw-btn');
  if (exportRawBtn) exportRawBtn.addEventListener('click', function () { exportGameEMGCSV(false); });

  var gameAlignBtn = $('game-alignment-btn');
  if (gameAlignBtn) gameAlignBtn.addEventListener('click', showGameAlignmentModal);

  var alignModalClose = $('align-modal-close');
  if (alignModalClose) {
    alignModalClose.addEventListener('click', function () {
      var modal = $('align-modal');
      if (modal) modal.style.display = 'none';
    });
  }

  window.addEventListener('click', function (e) {
    var modal = $('align-modal');
    if (modal && e.target === modal) {
      modal.style.display = 'none';
    }
  });

  var newSessionBtn = $('new-session-btn');
  if (newSessionBtn) newSessionBtn.addEventListener('click', resetToSetup);
}

function updateExerciseOptions(limb) {
  var select = $('inp-exercise');
  if (!select) return;
  select.innerHTML = '';
  var list = LIMB_EXERCISES[limb] || [];
  list.forEach(function (opt) {
    var el = document.createElement('option');
    el.value = opt.value;
    el.textContent = opt.label;
    if (opt.selected) el.selected = true;
    select.appendChild(el);
  });
}

function updateChannelLabels(limb) {
  var labels = CH_LABELS[limb] || {};
  [1, 2, 3, 4].forEach(function (chId) {
    var btn = $('ch-btn-' + chId);
    if (btn) {
      btn.textContent = labels[chId] || ('CH' + chId);
    }
  });
}

function showGameAlignmentModal() {
  if (typeof EmgEngine === 'undefined') return;
  var stats = EmgEngine.recorder.getAlignmentStats();
  var modal = $('align-modal');
  var body = $('align-modal-body');
  if (!modal || !body) return;

  if (!stats || !stats.active || !stats.active.length) {
    body.innerHTML = '<div style="text-align:center;padding:20px;color:#6b7590;">No recorded data to analyze.</div>';
    modal.style.display = 'flex';
    return;
  }

  var activeChannelsStr = stats.active.map(function (c) { return 'CH' + c; }).join(', ');
  var qualityColor = '#ff4d4d'; // red
  var verdict = 'Poor / Bad Sync';
  if (stats.alignedPct >= 95) {
    qualityColor = '#00e5a0'; // green
    verdict = 'Excellent Sync (Stable)';
  } else if (stats.alignedPct >= 80) {
    qualityColor = '#ffb84d'; // yellow
    verdict = 'Good Sync (Acceptable)';
  }

  var chColors = {
    1: '#00e5c8',
    2: '#ffb300',
    3: '#9d4edd',
    4: '#ff357a'
  };

  var channelsHtml = '';
  stats.active.forEach(function (c) {
    var chStats = stats.perChannel[c] || { count: 0, pct: 0 };
    channelsHtml +=
      '<div style="margin-top:12px;">' +
      '<div style="display:flex;justify-content:space-between;font-size:0.85rem;margin-bottom:4px;color:#a0aec0;">' +
      '<span>Channel ' + c + '</span>' +
      '<span style="margin-left:auto;">' + chStats.count + ' samples (' + chStats.pct + '%)</span>' +
      '</div>' +
      '<div style="height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;">' +
      '<div style="height:100%;width:' + chStats.pct + '%;background:' + (chColors[c] || '#4d9fff') + ';border-radius:3px;"></div>' +
      '</div>' +
      '</div>';
  });

  body.innerHTML =
    '<div style="text-align:center;margin-bottom:24px;">' +
    '<div style="font-size:2.8rem;font-weight:700;color:' + qualityColor + ';line-height:1.2;">' +
    stats.alignedPct + '%' +
    '</div>' +
    '<div style="font-size:0.95rem;font-weight:600;color:' + qualityColor + ';margin-top:4px;text-transform:uppercase;letter-spacing:1px;">' +
    verdict +
    '</div>' +
    '<div style="font-size:0.8rem;color:#6b7590;margin-top:2px;">' +
    'of total duration is fully time-aligned' +
    '</div>' +
    '</div>' +

    '<div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);border-radius:8px;padding:12px;font-size:0.85rem;line-height:1.6;color:#a0aec0;margin-bottom:20px;">' +
    '<div style="display:flex;justify-content:space-between;">' +
    '<span>Active Channels:</span>' +
    '<strong style="color:#e8ecf4;">' + activeChannelsStr + '</strong>' +
    '</div>' +
    '<div style="display:flex;justify-content:space-between;margin-top:4px;">' +
    '<span>Total Time Frames:</span>' +
    '<strong style="color:#e8ecf4;">' + stats.totalFrames + '</strong>' +
    '</div>' +
    '<div style="display:flex;justify-content:space-between;margin-top:4px;">' +
    '<span>Aligned Time Frames:</span>' +
    '<strong style="color:#e8ecf4;">' + stats.alignedFrames + '</strong>' +
    '</div>' +
    '<div style="display:flex;justify-content:space-between;margin-top:4px;">' +
    '<span>Session Duration:</span>' +
    '<strong style="color:#e8ecf4;">' + stats.durationS.toFixed(1) + 's</strong>' +
    '</div>' +
    '</div>' +

    '<div style="font-size:0.9rem;font-weight:600;color:#e8ecf4;margin-bottom:8px;">Channel Coverage Details:</div>' +
    channelsHtml;

  modal.style.display = 'flex';
}

// ── Keyboard fallback ────────────────────────────────
window.addEventListener('keydown', function (e) {
  if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault();
    EMG.rms = SESSION.threshold * 1.6;
    setTimeout(function () { EMG.rms = EMG.live ? EMG.rms : 0; }, 180);
  }
});

// ── DOM Initializations and Boot ──────────────────────
initSetupForm();
if (typeof EmgEngine !== 'undefined') EmgEngine.startBroadcast();
connectEMG();
updateCachedDimensions();

// Run static canvas loop
staticBg();
