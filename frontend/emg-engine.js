/**
 * emg-engine.js
 * Browser-side EMG data pipeline (replaces Python data_manager + recorder + filters).
 * Emits `emg-update` CustomEvents on window at ~30 FPS.
 */
'use strict';

const SLAVE_TO_CHANNEL = { 0: 1, 1: 2, 2: 3, 3: 4 };
const MAX_BUFFER_SAMPLES = 5000;
const BROADCAST_SAMPLES = 500;

/** Shared research protocol options (monitor + game). */
const RESEARCH = {
  EXERCISES: [
    { value: 'jump',       label: 'Jump' },
    { value: 'squat',      label: 'Squat' },
    { value: 'lunge',      label: 'Lunge' },
    { value: 'deadlift',   label: 'Deadlift' },
    { value: 'calf_raise', label: 'Calf Raise' },
    { value: 'box_jump',   label: 'Box Jump' },
  ],
  TRIALS: [1, 2, 3, 4, 5],
  SEX_OPTIONS: [
    { value: 'male',   label: 'Male' },
    { value: 'female', label: 'Female' },
  ],
};

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

// ── Recorder helpers ───────────────────────────────────────────────────────────

/** ESP32 master JSON sends t0 in milliseconds (see hardware.tex). */
function packetT0Us(packet) {
  if (packet.t0_us != null) return parseInt(packet.t0_us, 10);
  if (packet.t0_ms != null) return parseInt(packet.t0_ms, 10) * 1000;
  return parseInt(packet.t0 ?? 0, 10) * 1000;
}

function estimateMedianDtUs(chSamples, active) {
  const estimates = [];
  for (const c of active) {
    const samples = chSamples[c];
    if (samples.length < 2) continue;
    const diffs = [];
    for (let j = 1; j < Math.min(samples.length, 50); j++) {
      const d = samples[j].tsUs - samples[j - 1].tsUs;
      if (d > 0) diffs.push(d);
    }
    if (diffs.length) {
      diffs.sort((a, b) => a - b);
      estimates.push(diffs[Math.floor(diffs.length / 2)]);
    }
  }
  if (!estimates.length) return 1000;
  estimates.sort((a, b) => a - b);
  return estimates[Math.floor(estimates.length / 2)];
}

function nearestSample(samples, targetTs, toleranceUs) {
  if (!samples.length) return null;
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (samples[mid].tsUs < targetTs) lo = mid + 1;
    else hi = mid;
  }
  const candidates = [];
  if (lo > 0) candidates.push(samples[lo - 1]);
  if (lo < samples.length) candidates.push(samples[lo]);
  let best = null;
  let bestDiff = Infinity;
  for (const s of candidates) {
    const diff = Math.abs(s.tsUs - targetTs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = s;
    }
  }
  return bestDiff <= toleranceUs ? best : null;
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
    this._sex = 'male';
    this._age = 25;
    this._weight_kg = 70;
    this._height_cm = 170;
    this._exercise = 'squat';
    this._trial_no = 1;
    this._session_timestamp = '';
    this._chSamples = { 1: [], 2: [], 3: [], 4: [] };
    this._chDtUs = { 1: 1000, 2: 1000, 3: 1000, 4: 1000 };
    this._totalSamples = 0;
  }

  getMeta() {
    return {
      participant: this._participant,
      sex: this._sex,
      age: this._age,
      weight_kg: this._weight_kg,
      height_cm: this._height_cm,
      exercise: this._exercise,
      trial_no: this._trial_no,
      label: this._label,
      session_timestamp: this._session_timestamp,
    };
  }

  filenameBase() {
    const p = (this._participant || 'anon').replace(/\s+/g, '_');
    return `emg_${p}_trial${this._trial_no}_${this._exercise}`;
  }

  get isRecording() { return this._recording; }
  get label() { return this._label; }
  get participant() { return this._participant; }
  get sampleCount() { return this._totalSamples; }

  start({
    label = 'testing',
    participant = 'testing',
    sex = 'male',
    age = 25,
    weight_kg = 70,
    height_cm = 170,
    exercise = 'squat',
    trial_no = 1,
  } = {}) {
    this._chSamples = { 1: [], 2: [], 3: [], 4: [] };
    this._totalSamples = 0;
    this._participant = (participant || 'testing').trim() || 'testing';
    this._sex = sex || 'male';
    this._age = Math.max(1, Math.min(120, parseInt(age, 10) || 25));
    this._weight_kg = weight_kg;
    this._height_cm = height_cm;
    this._exercise = exercise || 'squat';
    this._trial_no = Math.max(1, Math.min(5, parseInt(trial_no, 10) || 1));
    this._label = (label || this._exercise).trim() || this._exercise;
    this._session_timestamp = new Date().toISOString();
    this._recording = true;
  }

  stop() {
    this._recording = false;
  }

  recordPacket(packet) {
    if (!this._recording) return;
    try {
      const slave = parseInt(packet.slave ?? -1, 10);
      const t0Us = packetT0Us(packet);
      const dt_us = parseInt(packet.dt_us ?? 1000, 10);
      const mv = packet.mv;
      const channel = SLAVE_TO_CHANNEL[slave];
      if (channel == null || !Array.isArray(mv) || !mv.length) return;

      const frameBase = packet.frame_id ?? packet.frame_id_start ?? packet.fid ?? null;

      if (dt_us > 0) this._chDtUs[channel] = dt_us;

      for (let i = 0; i < mv.length; i++) {
        const tsUs = t0Us + i * dt_us;
        const valMv = Math.round((parseInt(mv[i], 10) / 4095) * 3300 * 10) / 10;
        const syncKey = frameBase != null ? Number(frameBase) * 10000 + i : null;
        this._chSamples[channel].push({ tsUs, valMv, syncKey });
        this._totalSamples++;
      }
    } catch { /* ignore malformed */ }
  }

  /** Per-channel counts and sync quality for diagnostics. */
  getDiagnostics() {
    const active = [1, 2, 3, 4].filter(c => this._chSamples[c].length);
    if (!active.length) return { active: [], counts: {}, mismatch_pct: 0 };

    const counts = {};
    const rates = {};
    for (const c of active) {
      counts[c] = this._chSamples[c].length;
      const s = this._chSamples[c];
      if (s.length >= 2) {
        const spanUs = s[s.length - 1].tsUs - s[0].tsUs;
        rates[c] = spanUs > 0 ? Math.round((s.length - 1) / (spanUs / 1e6)) : 0;
      } else {
        rates[c] = 0;
      }
    }
    const vals = Object.values(counts);
    const maxC = Math.max(...vals);
    const minC = Math.min(...vals);
    const mismatch_pct = maxC > 0 ? Math.round((maxC - minC) / maxC * 1000) / 10 : 0;

    return { active, counts, rates, mismatch_pct, median_dt_us: estimateMedianDtUs(this._chSamples, active) };
  }

  _prepareChannelValues(active, applyFilter) {
    const chValues = {};
    for (const c of active) {
      const raw = this._chSamples[c].map(s => s.valMv);
      if (applyFilter) {
        const fs = 1_000_000 / (this._chDtUs[c] || 1000);
        chValues[c] = ChannelFilter.applyOffline(raw, fs);
      } else {
        chValues[c] = raw;
      }
    }
    return chValues;
  }

  _samplesWithValues(channel, chValues) {
    return this._chSamples[channel].map((s, i) => ({
      tsUs: s.tsUs,
      valMv: chValues[i],
      syncKey: s.syncKey,
    }));
  }

  /** Align channels by hardware syncKey (frame_id) when firmware provides it. */
  _buildAlignedRows(active, chValues, medianDtUs) {
    const hasSync = active.every(c =>
      this._chSamples[c].length > 0 &&
      this._chSamples[c].every(s => s.syncKey != null)
    );

    if (hasSync) {
      const keySet = new Set();
      for (const c of active) {
        for (const s of this._chSamples[c]) keySet.add(s.syncKey);
      }
      const keys = Array.from(keySet).sort((a, b) => a - b);
      const byKey = {};
      for (const c of active) {
        byKey[c] = new Map(this._samplesWithValues(c, chValues[c]).map(s => [s.syncKey, s]));
      }
      return keys.map((key, idx) => {
        const row = { index: idx, relTimeMs: null, cells: {} };
        let refTs = null;
        for (const c of active) {
          const hit = byKey[c].get(key);
          row.cells[c] = hit ? { tsUs: hit.tsUs, valMv: hit.valMv } : null;
          if (hit && refTs == null) refTs = hit.tsUs;
        }
        row.refTsUs = refTs;
        return row;
      });
    }

    // Timestamp grid alignment (honest: empty cell if no sample within ±dt/2)
    const tolerance = medianDtUs / 2;
    const tMin = Math.min(...active.map(c => this._chSamples[c][0].tsUs));
    const tMax = Math.max(...active.map(c => this._chSamples[c][this._chSamples[c].length - 1].tsUs));
    const prepared = {};
    for (const c of active) {
      prepared[c] = this._samplesWithValues(c, chValues[c]);
    }

    const rows = [];
    let idx = 0;
    for (let T = tMin; T <= tMax + medianDtUs / 2; T += medianDtUs) {
      const cells = {};
      let any = false;
      for (const c of active) {
        const hit = nearestSample(prepared[c], T, tolerance);
        cells[c] = hit ? { tsUs: hit.tsUs, valMv: hit.valMv } : null;
        if (hit) any = true;
      }
      if (any) {
        rows.push({ index: idx++, refTsUs: T, relTimeMs: (T - tMin) / 1000, cells });
      }
    }
    return rows;
  }

  _metaRowPrefix() {
    return [
      this._participant,
      this._sex,
      this._age,
      this._weight_kg,
      this._height_cm,
      this._exercise,
      this._trial_no,
      this._session_timestamp,
      this._label,
    ];
  }

  toCSV(applyFilter = true) {
    const active = [1, 2, 3, 4].filter(c => this._chSamples[c].length);
    if (!active.length) return 'sample_index,rel_time_ms\n';

    const medianDtUs = estimateMedianDtUs(this._chSamples, active);
    const chValues = this._prepareChannelValues(active, applyFilter);
    const aligned = this._buildAlignedRows(active, chValues, medianDtUs);
    const tMin = aligned.length ? (aligned[0].refTsUs ?? 0) : 0;
    const filterNote = applyFilter ? 'filtered' : 'raw';

    const header = [
      'participant', 'sex', 'age', 'weight_kg', 'height_cm',
      'exercise', 'trial_no', 'session_timestamp', 'label',
      'sample_index', 'ref_timestamp_us', 'rel_time_ms',
    ];
    for (const c of active) header.push(`ts_ch${c}_us`, `ch${c}_${filterNote}`);
    header.push('channels_present');

    const rows = [header.join(',')];
    for (const row of aligned) {
      const relMs = row.relTimeMs != null
        ? Math.round(row.relTimeMs * 1000) / 1000
        : Math.round((row.refTsUs - tMin) / 1000 * 1000) / 1000;
      const present = [];
      const data = [...this._metaRowPrefix(), row.index, row.refTsUs, relMs];
      for (const c of active) {
        const cell = row.cells[c];
        if (cell) {
          data.push(cell.tsUs, Math.round(cell.valMv * 100) / 100);
          present.push(c);
        } else {
          data.push('', '');
        }
      }
      data.push(present.join('|') || '');
      rows.push(data.join(','));
    }
    return rows.join('\n');
  }

  /** Long-format CSV: one row per sample — no cross-channel alignment assumptions. */
  toLongCSV(applyFilter = true) {
    const active = [1, 2, 3, 4].filter(c => this._chSamples[c].length);
    if (!active.length) return 'channel,timestamp_us,value_mV\n';

    const chValues = this._prepareChannelValues(active, applyFilter);
    const filterNote = applyFilter ? 'filtered' : 'raw';
    const header = [
      'participant', 'sex', 'age', 'weight_kg', 'height_cm',
      'exercise', 'trial_no', 'session_timestamp', 'label',
      'channel', 'timestamp_us', `value_mV_${filterNote}`, 'sync_key',
    ];
    const rows = [header.join(',')];
    const prefix = this._metaRowPrefix();

    for (const c of active) {
      const samples = this._chSamples[c];
      const vals = chValues[c];
      for (let i = 0; i < samples.length; i++) {
        rows.push([
          ...prefix,
          c,
          samples[i].tsUs,
          Math.round(vals[i] * 100) / 100,
          samples[i].syncKey ?? '',
        ].join(','));
      }
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
      recording_diag: this.recorder.isRecording ? this.recorder.getDiagnostics() : null,
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

  /** Trigger browser download of recorder CSV. */
  downloadRecorderCSV(applyFilter = true) {
    if (this.recorder.sampleCount === 0) return false;
    const csv = this.recorder.toCSV(applyFilter);
    const suffix = applyFilter ? 'aligned_filtered' : 'aligned_raw';
    const name = `${this.recorder.filenameBase()}_${suffix}.csv`;
    EmgEngine._downloadText(csv, name);
    return true;
  },

  downloadRecorderLongCSV(applyFilter = true) {
    if (this.recorder.sampleCount === 0) return false;
    const csv = this.recorder.toLongCSV(applyFilter);
    const suffix = applyFilter ? 'long_filtered' : 'long_raw';
    const name = `${this.recorder.filenameBase()}_${suffix}.csv`;
    EmgEngine._downloadText(csv, name);
    return true;
  },

  _downloadText(content, filename) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};

window.EmgEngine = EmgEngine;
window.RESEARCH = RESEARCH;
