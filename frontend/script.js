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
  compatBanner:    $('compat-banner'),
  grantedInfo:     $('granted-info'),
  baudSelect:      $('baud-select'),
  connectBtn:      $('connect-btn'),
  disconnectBtn:   $('disconnect-btn'),
  filterBtn:       $('filter-btn'),
  filtBadge:       $('filt-badge'),
  participantName:   $('participant-name'),
  participantWeight: $('participant-weight'),
  participantHeight: $('participant-height'),
  exerciseLabel:   $('exercise-label'),
  recLabelDisplay: $('rec-label-display'),
  recStartBtn:     $('rec-start-btn'),
  recStopBtn:      $('rec-stop-btn'),
  downloadBtn:     $('download-btn'),
  downloadRawBtn:  $('download-raw-btn'),
  connStatus:      $('conn-status'),
  statusDot:       $('status-dot'),
  statusText:      $('status-text'),
  recBadge:        $('rec-badge'),
  statPackets:     $('stat-packets'),
  statErrors:      $('stat-errors'),
  statBytes:       $('stat-bytes'),
  statRate:        $('stat-rate'),
  statLink:        $('stat-link'),
  statRec:         $('stat-rec'),
  footerTime:      $('footer-time'),
  toastContainer:  $('toast-container'),
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

function startRecording() {
  const label = dom.exerciseLabel?.value?.trim() || 'testing';
  const participant = dom.participantName?.value?.trim() || 'testing';
  const weight_kg = parseFloat(dom.participantWeight?.value) || 70;
  const height_cm = parseFloat(dom.participantHeight?.value) || 170;

  EmgEngine.resetFilters();
  EmgEngine.recorder.start({ label, participant, weight_kg, height_cm });
  toast(`⏺ Recording — ${participant} · "${label}"`, 'success', 4000);
  state.hasData = false;
  dom.downloadBtn.disabled = true;
  dom.downloadRawBtn.disabled = true;
}

function stopRecording() {
  EmgEngine.recorder.stop();
  const n = EmgEngine.recorder.sampleCount;
  toast(`⏹ Stopped — ${n} samples · "${EmgEngine.recorder.label}"`, 'success', 5000);
  state.hasData = n > 0;
  dom.downloadBtn.disabled = !state.hasData;
  dom.downloadRawBtn.disabled = !state.hasData;
}

function downloadCSV(filtered = true) {
  const csv = EmgEngine.recorder.toCSV(filtered);
  if (!csv || csv === 'sample_index,rel_time_ms\n') {
    toast('No data to download.', 'warning');
    return;
  }
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filtered ? `emg_filtered_${Date.now()}.csv` : `emg_raw_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast(filtered ? 'Filtered CSV downloaded.' : 'Raw CSV downloaded.', 'success');
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
  dom.footerTime.textContent = new Date().toLocaleString();
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
dom.downloadBtn.addEventListener('click', () => downloadCSV(true));
dom.downloadRawBtn.addEventListener('click', () => downloadCSV(false));

window.addEventListener('emg-update', onEmgUpdate);

SerialWeb.onDisconnect = () => {
  updateConnectionUI(false);
  dom.connectBtn.disabled = !SerialWeb.isSupported();
};

(async function init() {
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
      ? 'Ready. Plug in ESP32, click Connect, pick the USB port.'
      : 'This browser cannot use Web Serial.',
    'info',
    5000
  );
})();
