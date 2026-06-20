<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description"
    content="Real-time EMG Monitoring Dashboard — 4-channel electromyography signal acquisition, visualization, and recording via ESP32." />
  <title>EMG Monitor — Real-Time Dashboard</title>
  <link rel="stylesheet" href="style.css" />
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"></script>
</head>

<body>

  <div id="compat-banner" class="compat-banner hidden" role="alert"></div>

  <!-- ══════════════════════════════════════════════════════
     NAVIGATION BAR
════════════════════════════════════════════════════════ -->
  <nav class="navbar" role="banner" aria-label="EMG Monitor Navigation">
    <div class="nav-brand">
      <div class="nav-logo" aria-hidden="true">🧠</div>
      <div>
        <div class="nav-title">EMG Monitor</div>
        <div class="nav-subtitle">Real-Time Acquisition System</div>
      </div>
    </div>

    <div class="nav-right">
      <a href="/analyzer.html" id="analyzer-btn" title="Analyze CSV Alignment" aria-label="Analyze CSV Alignment" style="display:inline-flex;align-items:center;gap:6px;padding:7px 16px;
              background:rgba(0,212,232,0.12);
              border:1px solid rgba(0,212,232,0.3);border-radius:20px;
              color:#00d4e8;font-size:12px;font-family:'Orbitron',monospace;
              font-weight:700;letter-spacing:1.5px;text-decoration:none;
              transition:background 0.2s,box-shadow 0.2s;cursor:pointer;
              margin-right:8px;
              box-shadow:0 0 12px rgba(0,212,232,0.08);"
         onmouseover="this.style.boxShadow='0 0 20px rgba(0,212,232,0.25)'"
         onmouseout="this.style.boxShadow='0 0 12px rgba(0,212,232,0.08)'">
        📊 ANALYZER
      </a>
      <a href="/game.html" id="game-launch-btn" title="Open Muscle Rush Game" aria-label="Launch EMG muscle game" style="display:inline-flex;align-items:center;gap:6px;padding:7px 16px;
              background:linear-gradient(135deg,rgba(0,245,160,0.12),rgba(165,107,255,0.12));
              border:1px solid rgba(0,245,160,0.3);border-radius:20px;
              color:#00f5a0;font-size:12px;font-family:'Orbitron',monospace;
              font-weight:700;letter-spacing:1.5px;text-decoration:none;
              transition:background 0.2s,box-shadow 0.2s;cursor:pointer;
              box-shadow:0 0 12px rgba(0,245,160,0.08);"
        onmouseover="this.style.boxShadow='0 0 20px rgba(0,245,160,0.25)'"
        onmouseout="this.style.boxShadow='0 0 12px rgba(0,245,160,0.08)'">
        🎮 MUSCLE RUSH
      </a>
      <div id="filt-badge" class="filt-badge" role="status" aria-live="polite">
        <span class="filt-icon" aria-hidden="true">🔧</span>
        FILT
      </div>
      <div id="rec-badge" class="rec-badge" role="status" aria-live="polite">
        <span class="rec-dot" aria-hidden="true"></span>
        REC &mdash; <span id="rec-label-display">—</span>
      </div>
      <div id="conn-status" class="status-pill disconnected" role="status" aria-live="polite">
        <span class="status-dot" id="status-dot" aria-hidden="true"></span>
        <span id="status-text">Disconnected</span>
      </div>
    </div>
  </nav>

  <!-- ══════════════════════════════════════════════════════
     MAIN CONTENT
════════════════════════════════════════════════════════ -->
  <main class="main-container" role="main">

    <!-- ── Control Panel ── -->
    <section class="control-panel" aria-label="Connection Controls">

      <!-- Row 1: Web Serial connection (browser picks USB port) -->
      <div class="control-row control-left">
        <div class="form-group web-serial-hint">
          <label class="form-label">USB Device</label>
          <span id="granted-info" class="granted-info">Click Connect — browser will ask you to pick the USB port</span>
        </div>

        <div class="form-group">
          <label class="form-label" for="baud-select">Baud Rate</label>
          <select id="baud-select" aria-label="Select baud rate">
            <option value="9600">9600</option>
            <option value="57600">57600</option>
            <option value="115200">115200</option>
            <option value="230400">230400</option>
            <option value="460800">460800</option>
            <option value="921600" selected>921600</option>
          </select>
        </div>
        <div class="baud-hint" title="Firmware streams at 921600 baud — lower rates cause packet loss">
          ⚠ Use 921600
        </div>

        <div class="divider-v" aria-hidden="true"></div>

        <button id="connect-btn" class="btn btn-primary" aria-label="Connect USB device via Web Serial">
          <span class="btn-icon">⚡</span> Connect
        </button>
        <button id="disconnect-btn" class="btn btn-danger" disabled aria-label="Disconnect from serial port">
          <span class="btn-icon">✕</span> Disconnect
        </button>

        <div class="divider-v" aria-hidden="true"></div>

        <!-- Filter toggle -->
        <button id="filter-btn" class="btn btn-filter active" aria-label="Toggle noise filter"
          title="Bandpass 20–450 Hz + 50 Hz notch">
          <span class="btn-icon">🔧</span> Filter ON
        </button>
      </div>

      <!-- Row 2: Participant + research metadata -->
      <div class="control-row session-row">
        <div class="session-info-label">Research Session</div>

        <div class="form-group">
          <label class="form-label" for="participant-name">Participant ID</label>
          <input type="text" id="participant-name" value="P001" placeholder="e.g. P001" maxlength="40"
            aria-label="Participant ID" style="width:90px" />
        </div>

        <div class="form-group">
          <label class="form-label" for="participant-sex">Sex</label>
          <select id="participant-sex" aria-label="Sex" style="width:88px">
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="participant-age">Age</label>
          <input type="number" id="participant-age" value="25" min="10" max="100" step="1" aria-label="Age in years"
            style="width:58px" />
        </div>

        <div class="form-group">
          <label class="form-label" for="participant-weight">Weight (kg)</label>
          <input type="number" id="participant-weight" value="70" min="20" max="300" step="0.5"
            aria-label="Participant weight in kg" style="width:72px" />
        </div>

        <div class="form-group">
          <label class="form-label" for="participant-height">Height (cm)</label>
          <input type="number" id="participant-height" value="170" min="100" max="250" step="1"
            aria-label="Participant height in cm" style="width:72px" />
        </div>

        <div class="form-group">
          <label class="form-label" for="exercise-type">Exercise</label>
          <select id="exercise-type" aria-label="Exercise type" style="width:118px">
            <option value="leg_press" selected>Leg Press</option>
            <option value="lunges">Lunges</option>
            <option value="leg_curl">Leg Curl</option>
            <option value="squarts">Squarts</option>
            <option value="calf_raise">Calf Raise</option>
            <option value="walking">Walking</option>
            <option value="jumpin">Jumpin</option>
            <option value="stair_up_climb">Stair Up Climb</option>
            <option value="stair_down">Stair Down</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="trial-no">Trial</label>
          <select id="trial-no" aria-label="Trial number" style="width:62px">
            <option value="1" selected>1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="5">5</option>
          </select>
        </div>

        <div class="divider-v" aria-hidden="true"></div>

        <!-- Recording controls -->
        <button id="rec-start-btn" class="btn btn-record" disabled aria-label="Start recording">
          <span class="btn-icon">⏺</span> Record
        </button>
        <button id="rec-stop-btn" class="btn btn-record-stop hidden" aria-label="Stop recording">
          <span class="btn-icon">⏹</span> Stop
        </button>
        <button id="download-btn" class="btn btn-download" disabled aria-label="Download time-aligned filtered CSV">
          <span class="btn-icon">↓</span> Aligned (Filt)
        </button>
        <button id="download-raw-btn" class="btn btn-download-raw" disabled aria-label="Download time-aligned raw CSV">
          <span class="btn-icon">↓</span> Aligned (Raw)
        </button>
        <button id="download-long-btn" class="btn btn-download" disabled aria-label="Download long-format CSV"
          title="One row per sample — best for IEEE analysis">
          <span class="btn-icon">↓</span> Long CSV
        </button>
        <button id="alignment-btn" class="btn btn-align" disabled aria-label="Show data alignment analysis"
          title="Show how much of the recorded data is time-aligned across channels">
          <span class="btn-icon">📊</span> Alignment %
        </button>
      </div>

    </section>

    <!-- ── Stats Row ── -->
    <section class="stats-row" aria-label="System Statistics">
      <div class="stat-card" style="--accent-color: var(--accent-green)">
        <div class="stat-label">Packets Received</div>
        <div class="stat-value" id="stat-packets">0</div>
        <div class="stat-unit">total rx</div>
      </div>
      <div class="stat-card" style="--accent-color: var(--accent-red)">
        <div class="stat-label">Parse Errors</div>
        <div class="stat-value" id="stat-errors">0</div>
        <div class="stat-unit">malformed</div>
      </div>
      <div class="stat-card" style="--accent-color: var(--accent-cyan)">
        <div class="stat-label">Data Received</div>
        <div class="stat-value" id="stat-bytes">0</div>
        <div class="stat-unit">bytes</div>
      </div>
      <div class="stat-card" style="--accent-color: var(--accent-blue)">
        <div class="stat-label">Sample Rate</div>
        <div class="stat-value" id="stat-rate">—</div>
        <div class="stat-unit">Hz (ch 1)</div>
      </div>
      <div class="stat-card" style="--accent-color: var(--accent-purple)">
        <div class="stat-label">Data Link</div>
        <div class="stat-value" id="stat-link">—</div>
        <div class="stat-unit">Web Serial</div>
      </div>
      <div class="stat-card" style="--accent-color: var(--accent-amber)">
        <div class="stat-label">Recording</div>
        <div class="stat-value" id="stat-rec">Idle</div>
        <div class="stat-unit">status</div>
      </div>
    </section>

    <!-- ── Channel Cards ── -->
    <section class="channels-grid" aria-label="EMG Channel Waveforms">

      <!-- Channel 1 -->
      <article class="channel-card ch-1" aria-label="EMG Channel 1">
        <header class="channel-header">
          <div class="channel-id">
            <div class="ch-badge">1</div>
            <div>
              <div class="ch-name">Channel 1</div>
              <div class="ch-slave mono">slave&nbsp;0</div>
            </div>
          </div>
          <div class="channel-metrics">
            <div class="metric">
              <div class="metric-label">RMS (mV)</div>
              <div class="metric-value" id="ch1-rms">—</div>
            </div>
            <div class="metric">
              <div class="metric-label">Peak (mV)</div>
              <div class="metric-value" id="ch1-peak">—</div>
            </div>
            <button id="autoscale-btn-ch1" class="btn-autoscale active" onclick="toggleAutoScale(1)"
              title="Toggle auto-scale Y axis">&#10562; Auto</button>
          </div>
        </header>
        <div class="chart-wrap">
          <canvas id="chart-ch1" role="img" aria-label="EMG Channel 1 Waveform"></canvas>
        </div>
        <div class="channel-detail">
          <div class="detail-item">
            <span class="detail-label">Mean (mV)</span>
            <span class="detail-value" id="ch1-mean">—</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Peak-Peak (mV)</span>
            <span class="detail-value" id="ch1-pp">—</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">RMS (mV)</span>
            <span class="detail-value" id="ch1-rms2">—</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Rate</span>
            <span class="detail-value" id="ch1-rate">—</span>
          </div>
        </div>
      </article>

      <!-- Channel 2 -->
      <article class="channel-card ch-2" aria-label="EMG Channel 2">
        <header class="channel-header">
          <div class="channel-id">
            <div class="ch-badge">2</div>
            <div>
              <div class="ch-name">Channel 2</div>
              <div class="ch-slave mono">slave&nbsp;1</div>
            </div>
          </div>
          <div class="channel-metrics">
            <div class="metric">
              <div class="metric-label">RMS (mV)</div>
              <div class="metric-value" id="ch2-rms">—</div>
            </div>
            <div class="metric">
              <div class="metric-label">Peak (mV)</div>
              <div class="metric-value" id="ch2-peak">—</div>
            </div>
            <button id="autoscale-btn-ch2" class="btn-autoscale active" onclick="toggleAutoScale(2)"
              title="Toggle auto-scale Y axis">&#10562; Auto</button>
          </div>
        </header>
        <div class="chart-wrap">
          <canvas id="chart-ch2" role="img" aria-label="EMG Channel 2 Waveform"></canvas>
        </div>
        <div class="channel-detail">
          <div class="detail-item">
            <span class="detail-label">Mean (mV)</span>
            <span class="detail-value" id="ch2-mean">—</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Peak-Peak (mV)</span>
            <span class="detail-value" id="ch2-pp">—</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">RMS (mV)</span>
            <span class="detail-value" id="ch2-rms2">—</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Rate</span>
            <span class="detail-value" id="ch2-rate">—</span>
          </div>
        </div>
      </article>

      <!-- Channel 3 -->
      <article class="channel-card ch-3" aria-label="EMG Channel 3">
        <header class="channel-header">
          <div class="channel-id">
            <div class="ch-badge">3</div>
            <div>
              <div class="ch-name">Channel 3</div>
              <div class="ch-slave mono">slave&nbsp;2</div>
            </div>
          </div>
          <div class="channel-metrics">
            <div class="metric">
              <div class="metric-label">RMS (mV)</div>
              <div class="metric-value" id="ch3-rms">—</div>
            </div>
            <div class="metric">
              <div class="metric-label">Peak (mV)</div>
              <div class="metric-value" id="ch3-peak">—</div>
            </div>
            <button id="autoscale-btn-ch3" class="btn-autoscale active" onclick="toggleAutoScale(3)"
              title="Toggle auto-scale Y axis">&#10562; Auto</button>
          </div>
        </header>
        <div class="chart-wrap">
          <canvas id="chart-ch3" role="img" aria-label="EMG Channel 3 Waveform"></canvas>
        </div>
        <div class="channel-detail">
          <div class="detail-item">
            <span class="detail-label">Mean (mV)</span>
            <span class="detail-value" id="ch3-mean">—</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Peak-Peak (mV)</span>
            <span class="detail-value" id="ch3-pp">—</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">RMS (mV)</span>
            <span class="detail-value" id="ch3-rms2">—</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Rate</span>
            <span class="detail-value" id="ch3-rate">—</span>
          </div>
        </div>
      </article>

      <!-- Channel 4 -->
      <article class="channel-card ch-4" aria-label="EMG Channel 4">
        <header class="channel-header">
          <div class="channel-id">
            <div class="ch-badge">4</div>
            <div>
              <div class="ch-name">Channel 4</div>
              <div class="ch-slave mono">slave&nbsp;3</div>
            </div>
          </div>
          <div class="channel-metrics">
            <div class="metric">
              <div class="metric-label">RMS (mV)</div>
              <div class="metric-value" id="ch4-rms">—</div>
            </div>
            <div class="metric">
              <div class="metric-label">Peak (mV)</div>
              <div class="metric-value" id="ch4-peak">—</div>
            </div>
            <button id="autoscale-btn-ch4" class="btn-autoscale active" onclick="toggleAutoScale(4)"
              title="Toggle auto-scale Y axis">&#10562; Auto</button>
          </div>
        </header>
        <div class="chart-wrap">
          <canvas id="chart-ch4" role="img" aria-label="EMG Channel 4 Waveform"></canvas>
        </div>
        <div class="channel-detail">
          <div class="detail-item">
            <span class="detail-label">Mean (mV)</span>
            <span class="detail-value" id="ch4-mean">—</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Peak-Peak (mV)</span>
            <span class="detail-value" id="ch4-pp">—</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">RMS (mV)</span>
            <span class="detail-value" id="ch4-rms2">—</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Rate</span>
            <span class="detail-value" id="ch4-rate">—</span>
          </div>
        </div>
      </article>

    </section>
  </main>

  <!-- ── Footer ── -->
  <footer class="footer" role="contentinfo">
    <div class="footer-left">EMG Monitor v1.0 · Real-Time Electromyography Acquisition</div>
    <div class="footer-right" id="footer-time">—</div>
  </footer>

  <!-- ── Toast Container ── -->
  <div class="toast-container" id="toast-container" role="alert" aria-live="assertive"></div>

  <script src="emg-engine.js"></script>
  <script src="serial-web.js"></script>
  <script src="script.js"></script>
  <!-- ── Alignment Analysis Modal ── -->
  <div id="align-modal"
    style="display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;"
    role="dialog" aria-modal="true" aria-labelledby="align-modal-title">
    <div
      style="background:#1a1d2e;border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:32px 36px;min-width:380px;max-width:520px;width:90%;box-shadow:0 24px 80px rgba(0,0,0,0.6);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <h2 id="align-modal-title" style="margin:0;font-size:1.2rem;font-weight:700;color:#e8ecf4;">📊 Data Alignment
          Analysis</h2>
        <button id="align-modal-close"
          style="background:none;border:none;color:#6b7590;font-size:1.4rem;cursor:pointer;line-height:1;"
          aria-label="Close">&times;</button>
      </div>
      <div id="align-modal-body"></div>
    </div>
  </div>

</body>

</html>