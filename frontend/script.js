/**
 * script.js
 * EMG Monitor — Web Serial edition (no Python backend required).
 */
'use strict';

const CHART_WINDOW = 500;

const CH_COLORS = {
  1: { line: '#00e5a0', fill: 'rgba(0,229,160,0.08)' },
  2: { line: '#4d9fff', fill: 'rgba(77,159,255,0.08)' },
  3: { line: '#a56bff', fill: 'rgba(165,107,255,0.08)' },
  4: { line: '#ffb84d', fill: 'rgba(255,184,77,0.08)' },
};

const autoScale = { 1: true, 2: true, 3: true, 4: true };

const state = {
  connected: false,
  recording: false,
  filterEnabled: true,
  hasData: false,
};

const $ = id => document.getElementById(id);

const dom = {
  compatBanner: $('compat-banner'),
  grantedInfo: $('granted-info'),
  baudSelect: $('baud-select'),
  connectBtn: $('connect-btn'),
  disconnectBtn: $('disconnect-btn'),
  filterBtn: $('filter-btn'),
  filtBadge: $('filt-badge'),
  participantName: $('participant-name'),
  participantSex: $('participant-sex'),
  participantAge: $('participant-age'),
  participantWeight: $('participant-weight'),
  participantHeight: $('participant-height'),
  exerciseType: $('exercise-type'),
  trialNo: $('trial-no'),
  recLabelDisplay: $('rec-label-display'),
  recStartBtn: $('rec-start-btn'),
  recStopBtn: $('rec-stop-btn'),
  downloadAllBtn: $('download-all-btn'),
  connStatus: $('conn-status'),
  statusDot: $('status-dot'),
  statusText: $('status-text'),
  recBadge: $('rec-badge'),
  statPackets: $('stat-packets'),
  statErrors: $('stat-errors'),
  statBytes: $('stat-bytes'),
  statRate: $('stat-rate'),
  statLink: $('stat-link'),
  statRec: $('stat-rec'),
  footerTime: $('footer-time'),
  toastContainer: $('toast-container'),
};

// ═══════════════════════════════════════════════════
// CHARTS
// ═══════════════════════════════════════════════════

function createChart(canvasId, channelId) {
  const ctx = $(canvasId).getContext('2d');
  const color = CH_COLORS[channelId];
  const data = new Array(CHART_WINDOW).fill(null);

  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: Array.from({ length: CHART_WINDOW }, (_, i) => i),
      datasets: [{
        label: `CH${channelId}`,
        data,
        borderColor: color.line,
        backgroundColor: color.fill,
        borderWidth: 1.5,
        fill: true,
        pointRadius: 0,
        tension: 0.3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'none' },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { display: false, type: 'linear' },
        y: {
          display: true,
          position: 'left',
          min: 0,
          max: 3300,
          grid: { color: 'rgba(255,255,255,0.04)', lineWidth: 1 },
          ticks: {
            color: '#4a5568',
            font: { family: "'JetBrains Mono'", size: 10 },
            maxTicksLimit: 5,
          },
          border: { color: 'rgba(255,255,255,0.06)' },
        },
      },
    },
  });
}

const charts = {
  1: createChart('chart-ch1', 1),
  2: createChart('chart-ch2', 2),
  3: createChart('chart-ch3', 3),
  4: createChart('chart-ch4', 4),
};

function pushSamples(channelId, samples) {
  const chart = charts[channelId];
  const dataset = chart.data.datasets[0];

  for (const s of samples) {
    dataset.data.push(s);
    if (dataset.data.length > CHART_WINDOW) dataset.data.shift();
  }

  chart.data.labels = Array.from({ length: dataset.data.length }, (_, i) => i);

  if (autoScale[channelId]) {
    const validData = dataset.data.filter(v => v != null);
    if (validData.length) {
      const minVal = Math.min(...validData);
      const maxVal = Math.max(...validData);
      const range = maxVal - minVal || 10;
      const pad = range * 0.12;
      chart.options.scales.y.min = Math.max(0, minVal - pad);
      chart.options.scales.y.max = Math.min(3300, maxVal + pad);
    }
  } else {
    chart.options.scales.y.min = 0;
    chart.options.scales.y.max = 3300;
  }

  chart.update('none');
}

function toggleAutoScale(channelId) {
  autoScale[channelId] = !autoScale[channelId];
  const btn = document.getElementById(`autoscale-btn-ch${channelId}`);
  if (btn) {
    btn.textContent = autoScale[channelId] ? '⤢ Auto' : '⤢ Fixed';
    btn.classList.toggle('active', autoScale[channelId]);
  }
  if (!autoScale[channelId]) {
    const chart = charts[channelId];
    chart.options.scales.y.min = 0;
    chart.options.scales.y.max = 3300;
    chart.update('none');
  }
}
window.toggleAutoScale = toggleAutoScale;

function updateChannelUI(ch) {
  const id = ch.ch;
  const fmt = v => (v == null) ? '—' : v.toFixed(1);
  const fmtRate = v => (v && v > 0) ? `${v.toFixed(0)} Hz` : '—';

  const set = (elId, val) => { const el = $(elId); if (el) el.textContent = val; };

  set(`ch${id}-rms`, fmt(ch.rms));
  set(`ch${id}-peak`, fmt(ch.peak));
  set(`ch${id}-rms2`, fmt(ch.rms));
  set(`ch${id}-mean`, fmt(ch.mean));
  set(`ch${id}-pp`, fmt(ch.peak_to_peak));
  set(`ch${id}-rate`, fmtRate(ch.sample_rate));

  if (id === 1) {
    dom.statRate.textContent = ch.sample_rate > 0 ? ch.sample_rate.toFixed(0) : '—';
  }

  if (ch.samples?.length) pushSamples(id, ch.samples);
}

// ═══════════════════════════════════════════════════
// UI STATE
// ═══════════════════════════════════════════════════

function updateConnectionUI(connected) {
  state.connected = connected;
  if (connected) {
    dom.connStatus.className = 'status-pill connected';
    dom.statusDot.classList.add('pulse');
    dom.statusText.textContent = 'Connected';
    dom.connectBtn.disabled = true;
    dom.disconnectBtn.disabled = false;
    dom.recStartBtn.disabled = false;
    dom.statLink.textContent = 'Live';
  } else {
    dom.connStatus.className = 'status-pill disconnected';
    dom.statusDot.classList.remove('pulse');
    dom.statusText.textContent = 'Disconnected';
    dom.connectBtn.disabled = !SerialWeb.isSupported();
    dom.disconnectBtn.disabled = true;
    if (!state.recording) dom.recStartBtn.disabled = true;
    dom.statLink.textContent = '—';
  }
}

function updateRecordingUI(recording, label) {
  state.recording = recording;
  if (recording) {
    dom.recBadge.classList.add('active');
    dom.recStartBtn.classList.add('hidden');
    dom.recStopBtn.classList.remove('hidden');
    dom.statRec.textContent = 'Active';
    if (label && dom.recLabelDisplay) dom.recLabelDisplay.textContent = label;
  } else {
    dom.recBadge.classList.remove('active');
    dom.recStartBtn.classList.remove('hidden');
    dom.recStopBtn.classList.add('hidden');
    dom.statRec.textContent = 'Idle';
    if (dom.recLabelDisplay) dom.recLabelDisplay.textContent = '—';
  }
}

function updateFilterUI(enabled) {
  state.filterEnabled = enabled;
  if (enabled) {
    dom.filterBtn.className = 'btn btn-filter active';
    dom.filterBtn.innerHTML = '<span class="btn-icon">🔧</span> Filter ON';
    dom.filtBadge.classList.add('active');
  } else {
    dom.filterBtn.className = 'btn btn-filter';
    dom.filterBtn.innerHTML = '<span class="btn-icon">🔧</span> Filter OFF';
    dom.filtBadge.classList.remove('active');
  }
}

function onEmgUpdate(ev) {
  const msg = ev.detail;
  if (!msg || msg.type !== 'channels') return;

  if (msg.stats) {
    dom.statPackets.textContent = msg.stats.rx_packets ?? 0;
    dom.statErrors.textContent = msg.stats.rx_errors ?? 0;
    dom.statBytes.textContent = formatBytes(msg.stats.bytes_received ?? 0);
  }

  updateConnectionUI(msg.connected);
  updateRecordingUI(msg.recording, msg.recording_label);

  if (msg.filter_enabled !== undefined && msg.filter_enabled !== state.filterEnabled) {
    updateFilterUI(msg.filter_enabled);
  }

  if (msg.channels) {
    for (const ch of msg.channels) updateChannelUI(ch);
  }
}

// ═══════════════════════════════════════════════════
// SERIAL CONNECT / DISCONNECT
// ═══════════════════════════════════════════════════

async function connectSerial() {
  const baud = parseInt(dom.baudSelect.value, 10);
  dom.connectBtn.disabled = true;
  try {
    await SerialWeb.connect(baud);
    toast('ESP32 connected via Web Serial.', 'success');
    await updateGrantedInfo();
  } catch (err) {
    if (err.name !== 'NotFoundError') {
      toast(`Connection failed: ${err.message}`, 'error');
    }
    dom.connectBtn.disabled = false;
  }
}

async function disconnectSerial() {
  try {
    await SerialWeb.disconnect();
    toast('Disconnected.', 'info');
  } catch (err) {
    toast(`Disconnect error: ${err.message}`, 'error');
  }
}

async function updateGrantedInfo() {
  if (!dom.grantedInfo || !SerialWeb.isSupported()) return;
  const ports = await SerialWeb.getGrantedPorts();
  dom.grantedInfo.textContent = ports.length
    ? `${ports.length} device(s) remembered for this site`
    : 'Click Connect — browser will ask you to pick the USB port';
}

// ═══════════════════════════════════════════════════
// RECORDING (client-side)
// ═══════════════════════════════════════════════════

function readSessionMeta() {
  return {
    participant: dom.participantName?.value?.trim() || 'P001',
    sex: dom.participantSex?.value || 'male',
    age: parseInt(dom.participantAge?.value, 10) || 25,
    weight_kg: parseFloat(dom.participantWeight?.value) || 70,
    height_cm: parseFloat(dom.participantHeight?.value) || 170,
    exercise: dom.exerciseType?.value || 'walking',
    trial_no: parseInt(dom.trialNo?.value, 10) || 1,
    label: dom.exerciseType?.value || 'walking',
  };
}

function startRecording() {
  const meta = readSessionMeta();
  EmgEngine.resetFilters();
  EmgEngine.recorder.start(meta);
  toast(
    `⏺ Recording — ${meta.participant} · ${meta.exercise} · trial ${meta.trial_no}`,
    'success', 4000
  );
  state.hasData = false;
  dom.downloadAllBtn.disabled = true;
}

function stopRecording() {
  EmgEngine.recorder.stop();
  const n = EmgEngine.recorder.sampleCount;
  const diag = EmgEngine.recorder.getDiagnostics();

  let msg = `⏹ Stopped — ${n} samples · "${EmgEngine.recorder.label}"`;
  if (diag.active.length > 1) {
    const parts = diag.active.map(c => `CH${c}:${diag.counts[c]}@${diag.rates[c]}Hz`).join(' · ');
    msg += ` · ${parts}`;
    if (diag.mismatch_pct > 2) {
      toast(
        `⚠ Channel mismatch ${diag.mismatch_pct}% — use 921600 baud. Check ts_ch1 vs ts_ch2 in CSV. Long CSV has every sample.`,
        'warning', 8000
      );
    }
  }
  toast(msg, 'success', 6000);
  state.hasData = n > 0;
  dom.downloadAllBtn.disabled = !state.hasData;
}

function downloadAllAndAnalyze() {
  if (!state.hasData || EmgEngine.recorder.sampleCount === 0) {
    toast('No data to download.', 'warning');
    return;
  }
  
  // Download all 3 formats
  EmgEngine.downloadRecorderCSV(true);
  EmgEngine.downloadRecorderCSV(false);
  EmgEngine.downloadRecorderLongCSV(true);
  toast('All 3 CSV files downloaded.', 'success');

  // Trigger analysis popup
  const stats = EmgEngine.recorder.getAlignmentStats();
  if (!stats) return;

  const modal = document.getElementById('analyzer-modal');
  const body = document.getElementById('analyzer-modal-body');
  if (modal && body) {
    let html = `<p style="margin-bottom:12px;"><strong>Alignment Analysis Complete:</strong></p>`;
    html += `<div style="background:rgba(0,0,0,0.2);padding:12px;border-radius:8px;margin-bottom:12px;">`;
    html += `<div style="font-size:2rem;font-weight:bold;color:${stats.alignedPct > 95 ? '#00e5a0' : '#ff4d4d'};text-align:center;margin-bottom:8px;">${stats.alignedPct}% Aligned</div>`;
    html += `<div><strong>Total Time Frames:</strong> ${stats.totalFrames}</div>`;
    html += `<div><strong>Aligned Frames:</strong> ${stats.alignedFrames}</div>`;
    html += `<div><strong>Session Duration:</strong> ${stats.durationS} s</div>`;
    html += `</div>`;
    
    html += `<p style="font-size:0.8rem;color:#a0aec0;margin-bottom:8px;"><strong>Channels Active:</strong> ${stats.active.join(', ')}</p>`;
    
    // Add per channel stats
    if (stats.perChannel) {
      html += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">`;
      for (const ch of stats.active) {
        const pch = stats.perChannel[ch];
        html += `<div style="background:rgba(255,255,255,0.05);padding:8px;border-radius:6px;flex:1;min-width:100px;text-align:center;">`;
        html += `<div style="font-size:0.75rem;color:#cbd5e1;margin-bottom:4px;">CH ${ch} Coverage</div>`;
        html += `<div style="font-weight:bold;font-size:1.1rem;color:#fff;">${pch.coveragePct}%</div>`;
        html += `</div>`;
      }
      html += `</div>`;
    }

    body.innerHTML = html;
    modal.style.display = 'flex';
  }
}

function toggleFilter() {
  const newState = !state.filterEnabled;
  EmgEngine.filterEnabled = newState;
  if (newState) EmgEngine.resetFilters();
  updateFilterUI(newState);
  toast(
    newState ? '🔧 Noise filter enabled (bandpass 20–450 Hz + 50 Hz notch).' :
      '⚠️ Noise filter disabled — showing raw signal.',
    newState ? 'success' : 'warning',
    4000
  );
}

// ═══════════════════════════════════════════════════
// TOAST / UTILS
// ═══════════════════════════════════════════════════

const TOAST_ICONS = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };

function toast(message, type = 'info', duration = 3500) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${TOAST_ICONS[type] ?? ''}</span><span>${message}</span>`;
  dom.toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toast-out 0.3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function updateClock() {
  const tz = typeof getSystemTimezone === 'function' ? getSystemTimezone() : '';
  dom.footerTime.textContent = new Date().toLocaleString() + (tz ? ` (${tz})` : '');
}

function showCompatBanner() {
  const msg = SerialWeb.supportMessage();
  if (msg && dom.compatBanner) {
    dom.compatBanner.textContent = msg;
    dom.compatBanner.classList.remove('hidden');
    dom.connectBtn.disabled = true;
  }
}

// ═══════════════════════════════════════════════════
// EVENTS + INIT
// ═══════════════════════════════════════════════════

dom.connectBtn.addEventListener('click', connectSerial);
dom.disconnectBtn.addEventListener('click', disconnectSerial);
dom.filterBtn.addEventListener('click', toggleFilter);
dom.recStartBtn.addEventListener('click', startRecording);
dom.recStopBtn.addEventListener('click', stopRecording);
dom.downloadAllBtn.addEventListener('click', downloadAllAndAnalyze);

window.addEventListener('emg-update', onEmgUpdate);

SerialWeb.onDisconnect = () => {
  updateConnectionUI(false);
  dom.connectBtn.disabled = !SerialWeb.isSupported();
};

function loadCachedSession() {
  try {
    const cached = localStorage.getItem('emg_session_meta');
    if (cached) {
      const meta = JSON.parse(cached);
      if (meta.participant && dom.participantName) dom.participantName.value = meta.participant;
      if (meta.sex && dom.participantSex) dom.participantSex.value = meta.sex;
      if (meta.age && dom.participantAge) dom.participantAge.value = meta.age;
      if (meta.weight_kg && dom.participantWeight) dom.participantWeight.value = meta.weight_kg;
      if (meta.height_cm && dom.participantHeight) dom.participantHeight.value = meta.height_cm;
      if (meta.exercise && dom.exerciseType) dom.exerciseType.value = meta.exercise;
      if (meta.trial_no && dom.trialNo) dom.trialNo.value = meta.trial_no;
    }
  } catch (e) {
    console.error('Failed to load cached session:', e);
  }
}

function saveCachedSession() {
  try {
    const meta = {
      participant: dom.participantName?.value || '',
      sex: dom.participantSex?.value || 'male',
      age: dom.participantAge?.value || '25',
      weight_kg: dom.participantWeight?.value || '70',
      height_cm: dom.participantHeight?.value || '170',
      exercise: dom.exerciseType?.value || 'walking',
      trial_no: dom.trialNo?.value || '1',
    };
    localStorage.setItem('emg_session_meta', JSON.stringify(meta));
  } catch (e) {
    console.error('Failed to save cached session:', e);
  }
}

(async function init() {
  loadCachedSession();

  // Save cached session details on changes
  [dom.participantName, dom.participantSex, dom.participantAge, dom.participantWeight, dom.participantHeight, dom.exerciseType, dom.trialNo].forEach(el => {
    if (el) {
      el.addEventListener('change', saveCachedSession);
      el.addEventListener('input', saveCachedSession);
    }
  });

  showCompatBanner();
  EmgEngine.startBroadcast();
  await updateGrantedInfo();

  // Auto-reconnect if user already granted this site access to a port
  if (SerialWeb.isSupported()) {
    const baud = parseInt(dom.baudSelect.value, 10);
    const reconnected = await SerialWeb.reconnectGranted(baud);
    if (reconnected) toast('Reconnected to remembered USB device.', 'success');
  }

  updateClock();
  setInterval(updateClock, 1000);

  toast(
    SerialWeb.isSupported()
      ? `Ready. Timestamps use your PC clock (${getSystemTimezone()}). Connect at 921600 baud.`
      : 'This browser cannot use Web Serial.',
    'info',
    6000
  );
})();
