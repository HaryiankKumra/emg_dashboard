/**
 * emg-engine.js
 * Browser-side EMG data pipeline (replaces Python data_manager + recorder + filters).
 * Emits `emg-update` CustomEvents on window at ~30 FPS.
 *
 * Fix log (2026-06):
 *  - Hardware sample rate (dt_us from firmware) is now used for display instead
 *    of browser performance.now() measurements, which varied per channel due to
 *    USB serial batching delays.
 *  - Filter fs is now correctly 1000 Hz (matching beacon interval = 1 ms).
 *  - LP filter cap raised to 450 Hz to cover the full 20–500 Hz MyoWare hardware
 *    bandpass (450 Hz software LP provides a 50 Hz guard band below Nyquist).
 *  - tsUs per sample now derived from frame_id × BEACON_INTERVAL_US so every
 *    channel uses the SAME shared epoch → CSV alignment is exact.
 */
'use strict';

const SLAVE_TO_CHANNEL = { 0: 1, 1: 2, 2: 3, 3: 4 };
const MAX_BUFFER_SAMPLES = 5000;
const BROADCAST_SAMPLES  = 500;

// Master beacon fires every 1 ms = 1000 Hz.  Must match BEACON_INTERVAL_US in ESP_master.
const BEACON_INTERVAL_US = 1000;

/** Shared research protocol options (monitor + game). */
const RESEARCH = {
  EXERCISES: [
    { value: 'jump',       label: 'Jump' },
    { value: 'squat',      label: 'Squat' },
    { value: 'lunge',      label: 'Lunge' },
    { value: 'deadlift',   label: 'Deadlift / Stair Climbing' },
    { value: 'calf_raise', label: 'Calf Raise' },
    { value: 'box_jump',   label: 'Box Jump / Walking' },
    { value: 'walking',    label: 'Walking' },
    { value: 'stair_climb',label: 'Stair Climbing' },
  ],
  TRIALS: [1, 2, 3, 4, 5],
  SEX_OPTIONS: [
    { value: 'male',   label: 'Male' },
    { value: 'female', label: 'Female' },
  ],
};

// Channel label map for CSV headers
const CH_MUSCLE_LABEL = { 1: 'RF', 2: 'BF', 3: 'GAS', 4: 'TA' };
const CH_MUSCLE_FULL  = {
  1: 'Rectus_Femoris',
  2: 'Biceps_Femoris',
  3: 'Gastrocnemius',
  4: 'Tibialis_Anterior',
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
  constructor(fs = 500) {
    this.fs = fs;
    this.enabled = true;
    this._hp    = new Biquad();
    this._lp    = new Biquad();
    this._notch = new Biquad();
    this._rebuild(fs);
  }

  _rebuild(fs) {
    this.fs = fs;
    // Highpass at 20 Hz — removes motion artefact / DC offset
    this._hp.setParams(fs, 'highpass', 20, 0.707);
    // Lowpass: fs*0.45 keeps LP well below Nyquist; hard cap at 450 Hz covers
    // the full 20-450 Hz EMG spectrum at 1000 Hz sampling.
    this._lp.setParams(fs, 'lowpass', Math.min(450, fs * 0.45), 0.707);
    // 50 Hz notch — power line interference (Q=35 for sharp notch)
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

  static applyOffline(samples, fs = 500) {
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
    this._filters = {
      1: new ChannelFilter(),
      2: new ChannelFilter(),
      3: new ChannelFilter(),
      4: new ChannelFilter(),
    };
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
    this.buffer    = [];
    this.rms            = 0;
    this.mean           = 0;
    this.peak           = 0;
    this.peak_to_peak   = 0;
    this.sample_rate    = 0;   // browser-measured (backup)
    this._hwRate        = 0;   // hardware rate from dt_us — authoritative
    this._sampleCount   = 0;
    this._rateWindowStart = performance.now();
  }

  /**
   * Set the authoritative sample rate derived from firmware dt_us.
   * Called once per packet; far more stable than browser timing.
   */
  setHwRate(hz) {
    this._hwRate = hz;
  }

  clear() {
    this.buffer    = [];
    this.rms            = 0;
    this.mean           = 0;
    this.peak           = 0;
    this.peak_to_peak   = 0;
    this.sample_rate    = 0;
    this._hwRate        = 0;
    this._sampleCount   = 0;
    this._rateWindowStart = performance.now();
  }

  ingest(samples) {
    for (const s of samples) {
      this.buffer.push(s);
      if (this.buffer.length > MAX_BUFFER_SAMPLES) this.buffer.shift();
    }
    this._sampleCount += samples.length;
    const now     = performance.now();
    const elapsed = (now - this._rateWindowStart) / 1000;
    if (elapsed >= 0.5) {
      // Keep browser measurement as a sanity check / fallback
      this.sample_rate    = this._sampleCount / elapsed;
      this._sampleCount   = 0;
      this._rateWindowStart = now;
    }
    this._computeMetrics();
  }

  _computeMetrics() {
    const data = this.buffer;
    if (!data.length) return;
    let sum = 0, sumSq = 0, min = Infinity, max = -Infinity;
    for (const x of data) {
      sum   += x;
      sumSq += x * x;
      if (x < min) min = x;
      if (x > max) max = x;
    }
    const n = data.length;
    this.mean         = sum / n;
    this.rms          = Math.sqrt(sumSq / n);
    this.peak         = max;
    this.peak_to_peak = max - min;
  }

  snapshot() {
    const samples = this.buffer.slice(-BROADCAST_SAMPLES);
    // Prefer hardware rate (from dt_us). Falls back to browser measurement.
    const displayRate = this._hwRate > 0
      ? this._hwRate
      : Math.round(this.sample_rate * 10) / 10;
    return {
      ch:            this.channelId,
      rms:           Math.round(this.rms          * 10) / 10,
      mean:          Math.round(this.mean         * 10) / 10,
      peak:          Math.round(this.peak         * 10) / 10,
      peak_to_peak:  Math.round(this.peak_to_peak * 10) / 10,
      sample_rate:   displayRate,
      samples,
    };
  }
}

// ── Recorder helpers ───────────────────────────────────────────────────────────

/** ESP32 master JSON: t0 is a frame-based timestamp (frame_id × BEACON_INTERVAL_US/1000 ms). */
function packetT0Ms(packet) {
  if (packet.t0_ms != null) return parseInt(packet.t0_ms, 10);
  return parseInt(packet.t0 ?? 0, 10);
}

function packetT0Us(packet) {
  if (packet.t0_us != null) return parseInt(packet.t0_us, 10);
  return packetT0Ms(packet) * 1000;
}

function getSystemTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

function wallMsToIso(wallMs) {
  return new Date(wallMs).toISOString();
}

/** Local wall-clock string in system timezone (e.g. Asia/Kolkata on Indian PC). */
function wallMsToLocal(wallMs, timeZone) {
  const d  = new Date(wallMs);
  const tz = timeZone || getSystemTimezone();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find(p => p.type === t)?.value ?? '00';
  const ms  = String(d.getMilliseconds()).padStart(3, '0');
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}.${ms}`;
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
  if (!estimates.length) return BEACON_INTERVAL_US;
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
    if (diff < bestDiff) { bestDiff = diff; best = s; }
  }
  return bestDiff <= toleranceUs ? best : null;
}

// ── Recorder ─────────────────────────────────────────────────────────────────

class Recorder {
  constructor() {
    this.reset();
  }

  reset() {
    this._recording          = false;
    this._label              = 'testing';
    this._participant        = 'testing';
    this._sex                = 'male';
    this._age                = 25;
    this._weight_kg          = 70;
    this._height_cm          = 170;
    this._exercise           = 'squat';
    this._trial_no           = 1;
    this._session_timestamp  = '';
    this._timezone           = getSystemTimezone();
    this._wallOriginMs       = 0;
    this._perfOrigin         = 0;
    this._chSamples          = { 1: [], 2: [], 3: [], 4: [] };
    this._chDtUs             = { 1: BEACON_INTERVAL_US, 2: BEACON_INTERVAL_US,
                                  3: BEACON_INTERVAL_US, 4: BEACON_INTERVAL_US };
    this._totalSamples       = 0;
  }

  getMeta() {
    return {
      participant:       this._participant,
      sex:               this._sex,
      age:               this._age,
      weight_kg:         this._weight_kg,
      height_cm:         this._height_cm,
      exercise:          this._exercise,
      trial_no:          this._trial_no,
      label:             this._label,
      session_timestamp: this._session_timestamp,
      timezone:          this._timezone,
    };
  }

  filenameBase() {
    const p = (this._participant || 'anon').replace(/\s+/g, '_');
    return `emg_${p}_trial${this._trial_no}_${this._exercise}`;
  }

  get isRecording() { return this._recording; }
  get label()       { return this._label; }
  get participant() { return this._participant; }
  get sampleCount() { return this._totalSamples; }

  start({
    label        = 'testing',
    participant  = 'testing',
    sex          = 'male',
    age          = 25,
    weight_kg    = 70,
    height_cm    = 170,
    exercise     = 'squat',
    trial_no     = 1,
  } = {}) {
    this._chSamples    = { 1: [], 2: [], 3: [], 4: [] };
    this._totalSamples = 0;
    this._participant  = (participant || 'testing').trim() || 'testing';
    this._sex          = sex || 'male';
    this._age          = Math.max(1, Math.min(120, parseInt(age, 10) || 25));
    this._weight_kg    = weight_kg;
    this._height_cm    = height_cm;
    this._exercise     = exercise || 'squat';
    this._trial_no     = Math.max(1, Math.min(5, parseInt(trial_no, 10) || 1));
    this._label        = (label || this._exercise).trim() || this._exercise;
    this._session_timestamp = new Date().toISOString();
    this._timezone     = getSystemTimezone();
    this._wallOriginMs = Date.now();
    this._perfOrigin   = performance.now();
    this._recording    = true;
  }

  stop() {
    this._recording = false;
  }

  recordPacket(packet, hostRxPerf = performance.now()) {
    if (!this._recording) return;
    try {
      const slave     = parseInt(packet.slave ?? -1, 10);
      const channel   = SLAVE_TO_CHANNEL[slave];
      if (channel == null) return;

      const mv        = packet.mv;
      if (!Array.isArray(mv) || !mv.length) return;

      const frameBase = packet.frame_id_start ?? packet.frame_id ?? packet.fid ?? null;
      const dt_us     = parseInt(packet.dt_us ?? BEACON_INTERVAL_US, 10);
      const dtMs      = dt_us / 1000;

      if (dt_us > 0) this._chDtUs[channel] = dt_us;

      // tsUs is now frame_id × BEACON_INTERVAL_US — shared epoch across all channels.
      // This is the key fix: before, t0_ms was each slave's own millis() which
      // diverges per device.  Now t0_ms = frame_id_start × 2 ms (from firmware fix).
      const t0Us = packetT0Ms(packet) * 1000;

      const count = mv.length;
      for (let i = 0; i < count; i++) {
        const tsUs   = t0Us + i * dt_us;
        const valMv  = Math.round((parseInt(mv[i], 10) / 4095) * 3300 * 10) / 10;
        const syncKey = frameBase != null ? Number(frameBase) * 10000 + i : null;
        // Wall clock: last sample in batch ≈ receive time; earlier samples stepped back
        const ageMs      = (count - 1 - i) * dtMs;
        const samplePerf = hostRxPerf - ageMs;
        const wallMs     = this._wallOriginMs + (samplePerf - this._perfOrigin);
        this._chSamples[channel].push({
          tsUs,
          valMv,
          syncKey,
          espT0Ms:   packetT0Ms(packet) + Math.round(i * dtMs),
          wallMs,
          wallIso:   wallMsToIso(wallMs),
          wallLocal: wallMsToLocal(wallMs, this._timezone),
        });
        this._totalSamples++;
      }
    } catch { /* ignore malformed packets */ }
  }

  /** Per-channel counts and sync quality for diagnostics. */
  getDiagnostics() {
    const active = [1, 2, 3, 4].filter(c => this._chSamples[c].length);
    if (!active.length) return { active: [], counts: {}, mismatch_pct: 0 };

    const counts = {};
    const rates  = {};
    for (const c of active) {
      counts[c] = this._chSamples[c].length;
      const s   = this._chSamples[c];
      if (s.length >= 2) {
        const spanUs = s[s.length - 1].tsUs - s[0].tsUs;
        rates[c] = spanUs > 0 ? Math.round((s.length - 1) / (spanUs / 1e6)) : 0;
      } else {
        rates[c] = 0;
      }
    }
    const vals       = Object.values(counts);
    const maxC       = Math.max(...vals);
    const minC       = Math.min(...vals);
    const mismatch_pct = maxC > 0 ? Math.round((maxC - minC) / maxC * 1000) / 10 : 0;

    return {
      active,
      counts,
      rates,
      mismatch_pct,
      median_dt_us: estimateMedianDtUs(this._chSamples, active),
    };
  }

  /**
   * Compute data alignment statistics across all active channels.
   * Returns:
   *   - totalFrames:       total unique timestamp slots across all channels
   *   - alignedFrames:     frames where ALL active channels have data
   *   - alignedPct:        % of frames that are fully aligned
   *   - perChannel:        per-channel sample count and % of total frames covered
   *   - active:            list of active channel IDs
   *   - durationS:         estimated session duration in seconds
   */
  getAlignmentStats() {
    const active = [1, 2, 3, 4].filter(c => this._chSamples[c].length > 0);
    if (active.length === 0) {
      return { active: [], totalFrames: 0, alignedFrames: 0, alignedPct: 0, perChannel: {}, durationS: 0 };
    }

    // Build Set<tsUs> per channel
    const tsSets = {};
    for (const c of active) {
      tsSets[c] = new Set(this._chSamples[c].map(s => s.tsUs));
    }

    // Union of all timestamps = total possible frames
    const unionTs = new Set();
    for (const c of active) for (const ts of tsSets[c]) unionTs.add(ts);
    const totalFrames = unionTs.size;

    if (totalFrames === 0) {
      return { active, totalFrames: 0, alignedFrames: 0, alignedPct: 0, perChannel: {}, durationS: 0 };
    }

    // Count frames where ALL active channels have data (intersection)
    let alignedFrames = 0;
    for (const ts of unionTs) {
      if (active.every(c => tsSets[c].has(ts))) alignedFrames++;
    }

    const alignedPct = Math.round((alignedFrames / totalFrames) * 1000) / 10;

    // Per-channel: how many of the total frames does this channel cover?
    const perChannel = {};
    for (const c of active) {
      const count = tsSets[c].size;
      perChannel[c] = {
        samples: count,
        coveragePct: Math.round((count / totalFrames) * 1000) / 10,
      };
    }

    // Estimate session duration from timestamp span
    let minTs = Infinity, maxTs = -Infinity;
    for (const c of active) {
      for (const ts of tsSets[c]) {
        if (ts < minTs) minTs = ts;
        if (ts > maxTs) maxTs = ts;
      }
    }
    const durationS = (maxTs - minTs) > 0 ? Math.round((maxTs - minTs) / 1e6 * 10) / 10 : 0;

    return { active, totalFrames, alignedFrames, alignedPct, perChannel, durationS };
  }

  _prepareChannelValues(active, applyFilter) {
    const chValues = {};
    for (const c of active) {
      const raw = this._chSamples[c].map(s => s.valMv);
      if (applyFilter) {
        const fs = 1_000_000 / (this._chDtUs[c] || BEACON_INTERVAL_US);
        chValues[c] = ChannelFilter.applyOffline(raw, fs);
      } else {
        chValues[c] = raw;
      }
    }
    return chValues;
  }

  _samplesWithValues(channel, chValues) {
    return this._chSamples[channel].map((s, i) => ({
      tsUs:      s.tsUs,
      valMv:     chValues[i],
      syncKey:   s.syncKey,
      espT0Ms:   s.espT0Ms,
      wallMs:    s.wallMs,
      wallIso:   s.wallIso,
      wallLocal: s.wallLocal,
    }));
  }

  /**
   * Align channels by hardware timestamp (tsUs = frame_id * dt_us us).
   * Every slave samples on the SAME master beacon tick, so two samples with
   * identical tsUs are genuinely simultaneous.  Join on tsUs -> true parallel.
   */
  _buildAlignedRows(active, chValues, medianDtUs) {
    // Build Map<tsUs, sample> per channel (keep first on duplicate ts)
    const byTs = {};
    for (const c of active) {
      byTs[c] = new Map();
      for (const s of this._samplesWithValues(c, chValues[c])) {
        if (!byTs[c].has(s.tsUs)) {
          byTs[c].set(s.tsUs, {
            tsUs:      s.tsUs,
            valMv:     s.valMv,
            wallLocal: s.wallLocal,
            wallIso:   s.wallIso,
          });
        }
      }
    }

    // Union of all tsUs values across all channels, sorted ascending
    const tsSet = new Set();
    for (const c of active) for (const ts of byTs[c].keys()) tsSet.add(ts);
    const sortedTs = Array.from(tsSet).sort((a, b) => a - b);

    // One output row per timestamp; null where channel missed that beacon
    return sortedTs.map((ts, idx) => {
      const cells = {};
      for (const c of active) {
        const hit = byTs[c].get(ts);
        cells[c] = hit ? {
          tsUs:      hit.tsUs,
          valMv:     hit.valMv,
          wallLocal: hit.wallLocal,
          wallIso:   hit.wallIso,
        } : null;
      }
      return { index: idx, refTsUs: ts, relTimeMs: null, cells };
    });
  }

  /** Build the 2-line metadata comment header. */
  _metaHeader() {
    const line1 = `# participant=${this._participant} | sex=${this._sex} | age=${this._age} | weight_kg=${this._weight_kg} | height_cm=${this._height_cm}`;
    const line2 = `# exercise=${this._exercise} | trial_no=${this._trial_no} | label=${this._label} | session=${this._session_timestamp} | tz=${this._timezone}`;
    return line1 + '\n' + line2;
  }

  /**
   * Clean CSV export:
   *   Line 1: # participant metadata comment
   *   Line 2: # session metadata comment
   *   Line 3: column header
   *   Line 4+: datetime_local, ch1_mV, ch2_mV, ch3_mV  (NaN where channel missing)
   *
   * Alignment: exact sync key (frame_id × 10000 + i) — same shared epoch for all channels.
   */
  toCSV(applyFilter = true) {
    const active = [1, 2, 3, 4].filter(c => this._chSamples[c].length);
    if (!active.length) return '# no data\ndatetime_local\n';

    const medianDtUs = estimateMedianDtUs(this._chSamples, active);
    const chValues   = this._prepareChannelValues(active, applyFilter);
    const aligned    = this._buildAlignedRows(active, chValues, medianDtUs);
    const suffix     = applyFilter ? 'filtered_mV' : 'raw_mV';

    // Build column headers using muscle names
    const chHeaders = active.map(c => {
      const muscle = CH_MUSCLE_FULL[c] ?? `ch${c}`;
      return `${muscle}_${suffix}`;
    });
    const header = ['datetime_local', ...chHeaders].join(',');

    const lines = [this._metaHeader(), header];

    for (const row of aligned) {
      // Use the first non-null cell's wall timestamp as the row timestamp
      const refCell = active.map(c => row.cells[c]).find(Boolean);
      const dt = refCell?.wallLocal ?? refCell?.wallIso ?? '';

      const vals = active.map(c => {
        const cell = row.cells[c];
        return cell ? Math.round(cell.valMv * 100) / 100 : '';
      });

      lines.push([dt, ...vals].join(','));
    }

    return lines.join('\n');
  }

  /**
   * Long-format CSV: one row per sample, all channels stacked.
   * Still uses 2-line metadata header. Good for debugging individual channel timing.
   * Format: datetime_local, channel, muscle, hw_timestamp_us, value_mV
   */
  toLongCSV(applyFilter = true) {
    const active = [1, 2, 3, 4].filter(c => this._chSamples[c].length);
    if (!active.length) return '# no data\ndatetime_local,channel,muscle,hw_timestamp_us,value_mV\n';

    const chValues   = this._prepareChannelValues(active, applyFilter);
    const suffix     = applyFilter ? 'filtered_mV' : 'raw_mV';
    const header     = ['datetime_local', 'channel', 'muscle', 'hw_timestamp_us', suffix].join(',');
    const lines      = [this._metaHeader(), header];

    for (const c of active) {
      const samples = this._chSamples[c];
      const vals    = chValues[c];
      const muscle  = CH_MUSCLE_FULL[c] ?? `ch${c}`;
      for (let i = 0; i < samples.length; i++) {
        lines.push([
          samples[i].wallLocal || samples[i].wallIso || '',
          c,
          muscle,
          samples[i].tsUs,
          Math.round(vals[i] * 100) / 100,
        ].join(','));
      }
    }
    return lines.join('\n');
  }
}

// ── EMG Engine (singleton) ───────────────────────────────────────────────────

const EmgEngine = {
  _channels: {
    1: new ChannelData(1),
    2: new ChannelData(2),
    3: new ChannelData(3),
    4: new ChannelData(4),
  },
  _filterBank:  new FilterBank(),
  recorder:     new Recorder(),
  connected:    false,
  _stats:       { rx_packets: 0, rx_errors: 0, bytes_received: 0 },
  _rafId:       null,
  _lastBroadcast: 0,

  get filterEnabled()  { return this._filterBank.enabled; },
  set filterEnabled(v) { this._filterBank.enabled = v; },

  setStats(stats) {
    this._stats = { ...stats };
  },

  clearAllData() {
    for (const chId of [1, 2, 3, 4]) {
      this._channels[chId].clear();
    }
    this.resetFilters();
    this.recorder.reset();
    this._stats = { rx_packets: 0, rx_errors: 0, bytes_received: 0 };
    this._lastBroadcast = 0;
    this._emit();
  },

  setConnected(connected) {
    this.connected = connected;
    this._emit();
  },

  onPacket(packet, hostRxPerf) {
    try {
      const slave     = parseInt(packet.slave ?? -1, 10);
      const mv        = packet.mv;
      const dt_us     = parseInt(packet.dt_us ?? BEACON_INTERVAL_US, 10);
      const channelId = SLAVE_TO_CHANNEL[slave];
      if (channelId == null || !Array.isArray(mv)) return;

      const samples = mv.map(v =>
        Math.round((parseInt(v, 10) / 4095) * 3300 * 10) / 10
      );

      if (dt_us > 0) {
        const fsHz = 1_000_000 / dt_us;
        // Update filter coefficients for this channel's actual sample rate
        this._filterBank.updateFs(channelId, fsHz);
        // Set hardware-derived rate for stable UI display (all channels = 500 Hz)
        this._channels[channelId].setHwRate(fsHz);
      }

      const filtered = this._filterBank.process(channelId, samples);
      this._channels[channelId].ingest(filtered);
      this.recorder.recordPacket(packet, hostRxPerf ?? performance.now());
    } catch { /* ignore malformed packets */ }
  },

  resetFilters() {
    this._filterBank.resetAll();
  },

  getSnapshot() {
    return [1, 2, 3, 4].map(id => this._channels[id].snapshot());
  },

  _emit() {
    const detail = {
      type:            'channels',
      connected:       this.connected,
      recording:       this.recorder.isRecording,
      recording_label: this.recorder.label,
      filter_enabled:  this.filterEnabled,
      stats:           { ...this._stats },
      recording_diag:  this.recorder.isRecording ? this.recorder.getDiagnostics() : null,
      channels:        this.getSnapshot(),
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

  /** Download clean aligned CSV (2-line meta + datetime + muscle columns). */
  downloadRecorderCSV(applyFilter = true) {
    if (this.recorder.sampleCount === 0) return false;
    const csv    = this.recorder.toCSV(applyFilter);
    const suffix = applyFilter ? 'filtered' : 'raw';
    const name   = `${this.recorder.filenameBase()}_${suffix}.csv`;
    EmgEngine._downloadText(csv, name);
    return true;
  },

  /** Download long-format CSV (one row per sample, stacked channels). */
  downloadRecorderLongCSV(applyFilter = true) {
    if (this.recorder.sampleCount === 0) return false;
    const csv    = this.recorder.toLongCSV(applyFilter);
    const suffix = applyFilter ? 'long_filtered' : 'long_raw';
    const name   = `${this.recorder.filenameBase()}_${suffix}.csv`;
    EmgEngine._downloadText(csv, name);
    return true;
  },

  _downloadText(content, filename) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};

window.EmgEngine       = EmgEngine;
window.RESEARCH        = RESEARCH;
window.getSystemTimezone = getSystemTimezone;
