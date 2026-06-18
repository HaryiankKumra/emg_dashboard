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
    hurdlesInp.addEventListener('input', function() {
      SESSION.numHurdles = parseInt(this.value);
      $('hurdles-val').textContent = this.value;
    });
  }

  // Attempt time limit slider
  var timeInp = $('inp-timelimit');
  if (timeInp) {
    timeInp.addEventListener('input', function() {
      SESSION.attemptTimeLimit = parseInt(this.value);
      $('timelimit-val').textContent = this.value + ' s';
    });
  }

  // Channel buttons
  var chBtns = document.querySelectorAll('.channel-picker .ch-btn');
  chBtns.forEach(function(btn) {
    // Skip zoom button
    if (btn.id === 'anatomy-zoom-btn') return;

    btn.addEventListener('click', function() {
      var ch = parseInt(this.getAttribute('data-ch'));
      if (!SESSION.activeChannels) SESSION.activeChannels = [1];
      
      if (ch === 0) {
        // Auto mode
        SESSION.activeChannels = [0];
        chBtns.forEach(function(b) {
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
      
      SESSION.activeChannels.sort(function(a, b) { return a - b; });

      var label = SESSION.activeChannels.map(function(c) { return c === 0 ? 'AUTO' : 'CH' + c; }).join('+');
      var preview = $('ch-live-preview');
      if (preview) preview.textContent = 'Live RMS: — mV  [' + label + ' selected]';
      updateAnatomyCanvas();
    });
  });

  // Combination mode change
  var combModeSelect = $('inp-comb-mode');
  if (combModeSelect) {
    combModeSelect.addEventListener('change', function() {
      SESSION.combMode = this.value;
    });
  }

  // Limb options selector
  var limbSelect = $('inp-limb');
  if (limbSelect) {
    limbSelect.addEventListener('change', function() {
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
    addExBtn.addEventListener('click', function() {
      var customName = prompt("Enter name of custom exercise:");
      if (customName) {
        customName = customName.trim();
        if (customName.length > 0) {
          var value = customName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
          if (!LIMB_EXERCISES[SESSION.targetLimb]) {
            LIMB_EXERCISES[SESSION.targetLimb] = [];
          }
          // Mark others as not selected
          LIMB_EXERCISES[SESSION.targetLimb].forEach(function(o) { o.selected = false; });
          
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
    zoomBtn.addEventListener('click', function() {
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
  if (exportFiltBtn) exportFiltBtn.addEventListener('click', function() { exportGameEMGCSV(true); });

  var exportRawBtn = $('export-emg-raw-btn');
  if (exportRawBtn) exportRawBtn.addEventListener('click', function() { exportGameEMGCSV(false); });

  var newSessionBtn = $('new-session-btn');
  if (newSessionBtn) newSessionBtn.addEventListener('click', resetToSetup);
}

function updateExerciseOptions(limb) {
  var select = $('inp-exercise');
  if (!select) return;
  select.innerHTML = '';
  var list = LIMB_EXERCISES[limb] || [];
  list.forEach(function(opt) {
    var el = document.createElement('option');
    el.value = opt.value;
    el.textContent = opt.label;
    if (opt.selected) el.selected = true;
    select.appendChild(el);
  });
}

function updateChannelLabels(limb) {
  var labels = CH_LABELS[limb] || {};
  [1, 2, 3, 4].forEach(function(chId) {
    var btn = $('ch-btn-' + chId);
    if (btn) {
      btn.textContent = labels[chId] || ('CH' + chId);
    }
  });
}

// ── Keyboard fallback ────────────────────────────────
window.addEventListener('keydown', function(e) {
  if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault();
    EMG.rms = SESSION.threshold * 1.6;
    setTimeout(function() { EMG.rms = EMG.live ? EMG.rms : 0; }, 180);
  }
});

// ── DOM Initializations and Boot ──────────────────────
initSetupForm();
if (typeof EmgEngine !== 'undefined') EmgEngine.startBroadcast();
connectEMG();
updateCachedDimensions();

// Run static canvas loop
staticBg();
