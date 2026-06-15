/**
 * emg-engine.js
 * Browser-side EMG data pipeline (replaces Python data_manager + recorder + filters).
 * Emits `emg-update` CustomEvents on window at ~30 FPS.
 */
'use strict';

const SLAVE_TO_CHANNEL = { 0: 1, 1: 2, 2: 3, 3: 4 };
const MAX_BUFFER_SAMPLES = 5000;
const BROADCAST_SAMPLES = 500;

// ── Biquad IIR (RBJ cookbook) ────────────────────────────────────────────────

class Biquad {
  constructor() {
    this.b0 = 1; this.b1 = 0; this.b2 = 0;
    this.a1 = 0; this.a2 = 0;
    this.x1 = 0; this.x2 = 0;
    this.y1 = 0; this.y2 = 0;
  }

  reset() {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }

  setParams(fs, type, f0, Q = 0.707) {
    const w0 = (2 * Math.PI * f0) / fs;
    const cos = Math.cos(w0);
    const sin = Math.sin(w0);
    const alpha = sin / (2 * Q);

    let b0, b1, b2, a0, a1, a2;

    if (type === 'highpass') {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
    } else if (type === 'lowpass') {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
    } else if (type === 'notch') {
      b0 = 1;
      b1 = -2 * cos;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
    } else {
      return;
    }

    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
    this.reset();
  }

  step(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2
            - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  process(samples) {
    const out = new Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      out[i] = this.step(samples[i]);
    }
    return out;
  }
}

class ChannelFilter {
  constructor(fs = 1000) {
    this.fs = fs;
    this.enabled = true;
    this._hp = new Biquad();
    this._lp = new Biquad();
    this._notch = new Biquad();
    this._rebuild(fs);
  }

  _rebuild(fs) {
    this.fs = fs;
    this._hp.setParams(fs, 'highpass', 20, 0.707);
    this._lp.setParams(fs, 'lowpass', Math.min(450, fs * 0.45), 0.707);
    this._notch.setParams(fs, 'notch', 50, 35);
  }

  reset() {
    this._hp.reset();
    this._lp.reset();
    this._notch.reset();
  }

  updateFs(fs) {
    if (Math.abs(fs - this.fs) / Math.max(this.fs, 1) > 0.05) {
      this._rebuild(fs);
    }
  }

  process(samples) {
    if (!this.enabled || samples.length < 2) return samples;
    let x = this._hp.process(samples);
    x = this._lp.process(x);
    x = this._notch.process(x);
    return x;
  }

  static applyOffline(samples, fs = 1000) {
    if (samples.length < 27) return samples;
    const f = new ChannelFilter(fs);
    f.enabled = true;
    const fwd = f.process(samples);
    const rev = f.process([...samples].reverse()).reverse();
    return fwd.map((v, i) => (v + rev[i]) / 2);
  }
}

class FilterBank {
  constructor() {
    this._filters = { 1: new ChannelFilter(), 2: new ChannelFilter(), 3: new ChannelFilter(), 4: new ChannelFilter() };
    this._enabled = true;
  }

  get enabled() { return this._enabled; }
  set enabled(v) {
    this._enabled = v;
    for (const f of Object.values(this._filters)) f.enabled = v;
  }

  process(ch, samples) {
    const f = this._filters[ch];
    return f ? f.process(samples) : samples;
  }

  resetAll() {
    for (const f of Object.values(this._filters)) f.reset();
  }

  updateFs(ch, fs) {
    const f = this._filters[ch];
    if (f) f.updateFs(fs);
  }
}

// ── Channel buffer + metrics ─────────────────────────────────────────────────

class ChannelData {
  constructor(channelId) {
    this.channelId = channelId;
    this.buffer = [];
    this.rms = 0;
    this.mean = 0;
    this.peak = 0;
    this.peak_to_peak = 0;
    this.sample_rate = 0;
    this._sampleCount = 0;
    this._rateWindowStart = performance.now();
  }

  ingest(samples) {
    for (const s of samples) {
      this.buffer.push(s);
      if (this.buffer.length > MAX_BUFFER_SAMPLES) this.buffer.shift();
    }
    this._sampleCount += samples.length;
    const now = performance.now();
    const elapsed = (now - this._rateWindowStart) / 1000;
    if (elapsed >= 1) {
      this.sample_rate = this._sampleCount / elapsed;
      this._sampleCount = 0;
      this._rateWindowStart = now;
    }
    this._computeMetrics();
  }

  _computeMetrics() {
    const data = this.buffer;
    if (!data.length) return;
    let sum = 0, sumSq = 0, min = Infinity, max = -Infinity;
    for (const x of data) {
      sum += x;
      sumSq += x * x;
      if (x < min) min = x;
      if (x > max) max = x;
    }
    const n = data.length;
    this.mean = sum / n;
    this.rms = Math.sqrt(sumSq / n);
    this.peak = max;
    this.peak_to_peak = max - min;
  }

  snapshot() {
    const samples = this.buffer.slice(-BROADCAST_SAMPLES);
    return {
      ch: this.channelId,
      rms: Math.round(this.rms * 10) / 10,
      mean: Math.round(this.mean * 10) / 10,
      peak: Math.round(this.peak * 10) / 10,
      peak_to_peak: Math.round(this.peak_to_peak * 10) / 10,
      sample_rate: Math.round(this.sample_rate * 10) / 10,
      samples,
    };
  }
}

// ── Recorder ─────────────────────────────────────────────────────────────────

class Recorder {
  constructor() {
    this.reset();
  }

  reset() {
    this._recording = false;
    this._label = 'testing';
    this._participant = 'testing';
    this._weight_kg = 70;
    this._height_cm = 170;
    this._chSamples = { 1: [], 2: [], 3: [], 4: [] };
    this._chDtUs = { 1: 1000, 2: 1000, 3: 1000, 4: 1000 };
    this._totalSamples = 0;
  }

  get isRecording() { return this._recording; }
  get label() { return this._label; }
  get participant() { return this._participant; }
  get sampleCount() { return this._totalSamples; }

  start({ label = 'testing', participant = 'testing', weight_kg = 70, height_cm = 170 } = {}) {
    this._chSamples = { 1: [], 2: [], 3: [], 4: [] };
    this._totalSamples = 0;
    this._label = (label || 'testing').trim() || 'testing';
    this._participant = (participant || 'testing').trim() || 'testing';
    this._weight_kg = weight_kg;
    this._height_cm = height_cm;
    this._recording = true;
  }

  stop() {
    this._recording = false;
  }

  recordPacket(packet) {
    if (!this._recording) return;
    try {
      const slave = parseInt(packet.slave ?? -1, 10);
      const t0 = parseInt(packet.t0 ?? 0, 10);
      const dt_us = parseInt(packet.dt_us ?? 1000, 10);
      const mv = packet.mv;
      const channel = SLAVE_TO_CHANNEL[slave];
      if (channel == null || !Array.isArray(mv) || !mv.length) return;

      if (dt_us > 0) this._chDtUs[channel] = dt_us;

      for (let i = 0; i < mv.length; i++) {
        const ts = t0 + i * dt_us;
        const mvVal = Math.round((parseInt(mv[i], 10) / 4095) * 3300 * 10) / 10;
        this._chSamples[channel].push([ts, mvVal]);
        this._totalSamples++;
      }
    } catch { /* ignore malformed */ }
  }

  toCSV(applyFilter = true) {
    const ch = this._chSamples;
    const dt_us = this._chDtUs;
    const active = [1, 2, 3, 4].filter(c => ch[c].length);
    if (!active.length) return 'sample_index,rel_time_ms\n';

    const nRows = Math.max(...active.map(c => ch[c].length));
    const dtEstimates = [];
    for (const c of active) {
      const samples = ch[c];
      if (samples.length >= 2) {
        const diffs = [];
        for (let j = 1; j < Math.min(samples.length, 20); j++) {
          if (samples[j][0] > samples[j - 1][0]) {
            diffs.push(samples[j][0] - samples[j - 1][0]);
          }
        }
        if (diffs.length) dtEstimates.push(diffs.reduce((a, b) => a + b, 0) / diffs.length);
      }
    }
    const medianDtUs = dtEstimates.length
      ? dtEstimates.reduce((a, b) => a + b, 0) / dtEstimates.length
      : 1000;

    const chValues = {};
    for (const c of active) {
      const raw = ch[c].map(([, v]) => v);
      if (applyFilter) {
        const fs = 1_000_000 / (dt_us[c] || 1000);
        chValues[c] = ChannelFilter.applyOffline(raw, fs);
      } else {
        chValues[c] = raw;
      }
    }

    const filterNote = applyFilter ? 'filtered' : 'raw';
    const header = ['participant', 'weight_kg', 'height_cm', 'label', 'sample_index', 'rel_time_ms'];
    for (const c of active) header.push(`ts_ch${c}_us`, `ch${c}_${filterNote}`);

    const rows = [header.join(',')];
    for (let i = 0; i < nRows; i++) {
      const relTimeMs = Math.round(i * medianDtUs / 1000 * 1000) / 1000;
      const row = [
        this._participant, this._weight_kg, this._height_cm,
        this._label, i, relTimeMs,
      ];
      for (const c of active) {
        const tsUs = i < ch[c].length ? ch[c][i][0] : '';
        const val = i < chValues[c].length ? Math.round(chValues[c][i] * 100) / 100 : '';
        row.push(tsUs, val);
      }
      rows.push(row.join(','));
    }
    return rows.join('\n');
  }
}

// ── EMG Engine (singleton) ───────────────────────────────────────────────────

const EmgEngine = {
  _channels: { 1: new ChannelData(1), 2: new ChannelData(2), 3: new ChannelData(3), 4: new ChannelData(4) },
  _filterBank: new FilterBank(),
  recorder: new Recorder(),
  connected: false,
  _stats: { rx_packets: 0, rx_errors: 0, bytes_received: 0 },
  _rafId: null,
  _lastBroadcast: 0,

  get filterEnabled() { return this._filterBank.enabled; },
  set filterEnabled(v) { this._filterBank.enabled = v; },

  setStats(stats) {
    this._stats = { ...stats };
  },

  setConnected(connected) {
    this.connected = connected;
    this._emit();
  },

  onPacket(packet) {
    try {
      const slave = parseInt(packet.slave ?? -1, 10);
      const mv = packet.mv;
      const dt_us = parseInt(packet.dt_us ?? 1000, 10);
      const channelId = SLAVE_TO_CHANNEL[slave];
      if (channelId == null || !Array.isArray(mv)) return;

      const samples = mv.map(v =>
        Math.round((parseInt(v, 10) / 4095) * 3300 * 10) / 10
      );

      if (dt_us > 0) {
        this._filterBank.updateFs(channelId, 1_000_000 / dt_us);
      }

      const filtered = this._filterBank.process(channelId, samples);
      this._channels[channelId].ingest(filtered);
      this.recorder.recordPacket(packet);
    } catch { /* ignore */ }
  },

  resetFilters() {
    this._filterBank.resetAll();
  },

  getSnapshot() {
    return [1, 2, 3, 4].map(id => this._channels[id].snapshot());
  },

  _emit() {
    const detail = {
      type: 'channels',
      connected: this.connected,
      recording: this.recorder.isRecording,
      recording_label: this.recorder.label,
      filter_enabled: this.filterEnabled,
      stats: { ...this._stats },
      channels: this.getSnapshot(),
    };
    window.dispatchEvent(new CustomEvent('emg-update', { detail }));
  },

  startBroadcast() {
    if (this._rafId != null) return;
    const tick = (ts) => {
      if (ts - this._lastBroadcast >= 33) {
        this._lastBroadcast = ts;
        this._emit();
      }
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  },

  stopBroadcast() {
    if (this._rafId != null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  },
};

window.EmgEngine = EmgEngine;
