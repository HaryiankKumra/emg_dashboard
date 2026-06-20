<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Data Alignment Analyzer | sEMG Biofeedback</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Orbitron:wght@700;900&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-darker: #02050e;
      --bg-dark: #04091a;
      --bg-panel: #0a0f26;
      --border: rgba(255, 255, 255, 0.08);
      --text: #e2e8f0;
      --text-muted: #64748b;
      
      --accent-cyan: #00d4e8;
      --accent-teal: #00e5c8;
      --accent-purple: #9d4edd;
      --accent-pink: #ff357a;
      --accent-yellow: #ffb300;
      --accent-green: #00e5a0;
      --accent-red: #ff4d4d;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background: linear-gradient(135deg, var(--bg-darker), var(--bg-dark));
      color: var(--text);
      font-family: 'Inter', -apple-system, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      padding: 24px;
    }

    /* Navbar */
    .navbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px 24px;
      background: rgba(10, 15, 38, 0.4);
      backdrop-filter: blur(8px);
      margin-bottom: 24px;
      width: 100%;
      max-width: 1200px;
      margin-left: auto;
      margin-right: auto;
    }

    .nav-brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .nav-logo {
      font-size: 1.5rem;
    }

    .nav-title {
      font-family: 'Orbitron', sans-serif;
      font-weight: 900;
      font-size: 1rem;
      letter-spacing: 2px;
      background: linear-gradient(135deg, #00d4e8, #9d4edd);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .nav-subtitle {
      font-size: 0.7rem;
      color: var(--text-muted);
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .nav-links {
      display: flex;
      gap: 12px;
    }

    .nav-btn {
      padding: 8px 16px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border);
      border-radius: 20px;
      color: var(--text);
      font-size: 0.8rem;
      text-decoration: none;
      font-weight: 600;
      transition: background 0.2s, color 0.2s;
    }

    .nav-btn:hover {
      background: rgba(255, 255, 255, 0.12);
      color: #fff;
    }

    /* Main Container */
    .container {
      flex: 1;
      width: 100%;
      max-width: 1200px;
      margin-left: auto;
      margin-right: auto;
      display: grid;
      grid-template-columns: 1fr;
      gap: 24px;
    }

    @media (min-width: 900px) {
      .container {
        grid-template-columns: 380px 1fr;
      }
    }

    /* Sidebar / Dropzone Panel */
    .sidebar {
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .panel {
      background: var(--bg-panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    }

    .panel-header {
      font-weight: 700;
      font-size: 1.1rem;
      color: #fff;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* File Dropzone */
    .dropzone {
      border: 2px dashed rgba(255, 255, 255, 0.15);
      border-radius: 10px;
      padding: 32px 16px;
      text-align: center;
      background: rgba(255, 255, 255, 0.01);
      cursor: pointer;
      transition: border-color 0.2s, background-color 0.2s;
      position: relative;
    }

    .dropzone:hover, .dropzone.dragover {
      border-color: var(--accent-cyan);
      background: rgba(0, 212, 232, 0.03);
    }

    .dropzone-icon {
      font-size: 2.5rem;
      margin-bottom: 12px;
      display: inline-block;
      transition: transform 0.2s;
    }

    .dropzone:hover .dropzone-icon {
      transform: translateY(-4px);
    }

    .dropzone-title {
      font-size: 0.95rem;
      font-weight: 600;
      color: #fff;
      margin-bottom: 6px;
    }

    .dropzone-subtitle {
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    #file-input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
      width: 100%;
      height: 100%;
    }

    /* Progress Info */
    .progress-container {
      display: none;
      margin-top: 16px;
    }

    .progress-bar-bg {
      height: 6px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 3px;
      overflow: hidden;
      margin-bottom: 8px;
    }

    .progress-bar {
      height: 100%;
      width: 0%;
      background: var(--accent-cyan);
      transition: width 0.1s;
    }

    .progress-text {
      display: flex;
      justify-content: space-between;
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    /* Metadata Card */
    .meta-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .meta-item {
      display: flex;
      justify-content: space-between;
      font-size: 0.85rem;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.03);
    }

    .meta-lbl {
      color: var(--text-muted);
    }

    .meta-val {
      font-weight: 600;
      color: #fff;
    }

    /* Results Dashboard */
    .results-panel {
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .results-placeholder {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 48px;
      color: var(--text-muted);
    }

    .results-placeholder-icon {
      font-size: 4rem;
      margin-bottom: 16px;
      opacity: 0.25;
    }

    .results-content {
      display: none;
      flex-direction: column;
      gap: 24px;
    }

    /* Summary Block */
    .summary-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
    }

    @media (min-width: 600px) {
      .summary-grid {
        grid-template-columns: 1.2fr 1fr;
      }
    }

    .stat-main {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.04);
      border-radius: 10px;
      padding: 24px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }

    .stat-main-pct {
      font-size: 3.8rem;
      font-weight: 700;
      line-height: 1.1;
      font-family: 'Orbitron', monospace;
    }

    .stat-main-lbl {
      font-size: 0.9rem;
      font-weight: 600;
      letter-spacing: 1px;
      text-transform: uppercase;
      margin-top: 6px;
    }

    .stat-main-sub {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 2px;
    }

    .stats-card-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
    }

    @media (min-width: 450px) {
      .stats-card-grid {
        grid-template-columns: 1fr 1fr;
      }
    }

    .mini-card {
      background: rgba(255, 255, 255, 0.015);
      border: 1px solid rgba(255, 255, 255, 0.03);
      border-radius: 8px;
      padding: 14px 16px;
    }

    .mini-card-lbl {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .mini-card-val {
      font-size: 1.1rem;
      font-weight: 700;
      color: #fff;
      font-family: 'Orbitron', monospace;
    }

    /* Channel Meters */
    .channels-header {
      font-weight: 600;
      font-size: 0.95rem;
      color: #fff;
      margin-bottom: 12px;
    }

    .channel-meter-row {
      margin-top: 14px;
    }

    .channel-meter-info {
      display: flex;
      justify-content: space-between;
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-bottom: 4px;
    }

    .channel-meter-name {
      font-weight: 600;
      color: #cbd5e1;
    }

    .channel-meter-bg {
      height: 6px;
      background: rgba(255, 255, 255, 0.04);
      border-radius: 3px;
      overflow: hidden;
    }

    .channel-meter-bar {
      height: 100%;
      border-radius: 3px;
      width: 0%;
      transition: width 0.6s cubic-bezier(0.1, 0.8, 0.3, 1);
    }

    /* Table Preview */
    .table-wrap {
      overflow-x: auto;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.01);
    }

    .preview-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
      text-align: left;
    }

    .preview-table th {
      background: rgba(255, 255, 255, 0.03);
      padding: 10px 12px;
      font-weight: 600;
      color: #cbd5e1;
      border-bottom: 1px solid var(--border);
    }

    .preview-table td {
      padding: 8px 12px;
      color: #94a3b8;
      border-bottom: 1px dotted rgba(255, 255, 255, 0.03);
    }

    .preview-table tr:last-child td {
      border-bottom: none;
    }

    .preview-table tr.unaligned td {
      background: rgba(255, 77, 77, 0.03);
      color: #f87171;
    }

    .badge-ok {
      padding: 2px 6px;
      background: rgba(0, 229, 160, 0.12);
      border: 1px solid rgba(0, 229, 160, 0.25);
      border-radius: 4px;
      color: var(--accent-green);
      font-size: 0.7rem;
      font-weight: 600;
    }

    .badge-fail {
      padding: 2px 6px;
      background: rgba(255, 77, 77, 0.12);
      border: 1px solid rgba(255, 77, 77, 0.25);
      border-radius: 4px;
      color: var(--accent-red);
      font-size: 0.7rem;
      font-weight: 600;
    }

    /* Toast */
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 12px 24px;
      font-size: 0.85rem;
      color: #fff;
      display: none;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
      z-index: 9999;
    }
  </style>
</head>
<body>

  <nav class="navbar" role="banner">
    <div class="nav-brand">
      <div class="nav-logo">📊</div>
      <div>
        <div class="nav-title">Data Alignment Analyzer</div>
        <div class="nav-subtitle">Offline sEMG Synchronization Tool</div>
      </div>
    </div>
    <div class="nav-links">
      <a href="/" class="nav-btn">← Monitor</a>
      <a href="/game.html" class="nav-btn">🎮 Game</a>
    </div>
  </nav>

  <div class="container">
    
    <!-- Sidebar / File Upload -->
    <div class="sidebar">
      
      <div class="panel">
        <div class="panel-header">📂 Upload Collected CSV</div>
        
        <div class="dropzone" id="drop-area">
          <span class="dropzone-icon">📥</span>
          <div class="dropzone-title">Drag & drop CSV file here</div>
          <div class="dropzone-subtitle">or click to browse from device</div>
          <input type="file" id="file-input" accept=".csv">
        </div>

        <div class="progress-container" id="prog-wrap">
          <div class="progress-bar-bg">
            <div class="progress-bar" id="prog-bar"></div>
          </div>
          <div class="progress-text">
            <span id="prog-state">Reading file...</span>
            <span id="prog-pct">0%</span>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">ℹ️ Session Metadata</div>
        <div class="meta-list" id="meta-output">
          <div style="text-align:center;color:var(--text-muted);font-size:0.8rem;padding:12px;">
            Upload a file to extract metadata comments.
          </div>
        </div>
      </div>

    </div>

    <!-- Main Results Block -->
    <div class="panel results-panel">
      
      <div class="results-placeholder" id="placeholder">
        <div class="results-placeholder-icon">📊</div>
        <h2>No Analysis Performed</h2>
        <p style="margin-top:6px;max-width:340px;">Select or drop a 2–5 MB EMG CSV recording file to inspect its timestamp alignment metrics.</p>
      </div>

      <div class="results-content" id="content">
        
        <!-- Summary stats -->
        <div class="summary-grid">
          
          <div class="stat-main">
            <div class="stat-main-pct" id="out-pct">0%</div>
            <div class="stat-main-lbl" id="out-verdict">Evaluating</div>
            <div class="stat-main-sub">timestamp frames are fully aligned across all channels</div>
          </div>

          <div class="stats-card-grid">
            <div class="mini-card">
              <div class="mini-card-lbl">Total Time Frames</div>
              <div class="mini-card-val" id="out-total">—</div>
            </div>
            <div class="mini-card">
              <div class="mini-card-lbl">Aligned Time Frames</div>
              <div class="mini-card-val" id="out-aligned">—</div>
            </div>
            <div class="mini-card">
              <div class="mini-card-lbl">Active Channels</div>
              <div class="mini-card-val" id="out-channels">—</div>
            </div>
            <div class="mini-card">
              <div class="mini-card-lbl">File Format Type</div>
              <div class="mini-card-val" id="out-format">—</div>
            </div>
          </div>

        </div>

        <!-- Channel Progress Meters -->
        <div>
          <div class="channels-header">📻 Channel Data Coverage</div>
          <div id="channels-meters-list"></div>
        </div>

        <!-- Row alignment inspection -->
        <div>
          <div class="channels-header" style="display:flex;justify-content:space-between;align-items:center;">
            <span>🔍 Row Inspection (First 10 Data Rows)</span>
            <span style="font-size:0.75rem;font-weight:400;color:var(--text-muted);">Unaligned rows highlighted in red</span>
          </div>
          <div class="table-wrap">
            <table class="preview-table">
              <thead id="preview-thead">
                <tr><th>Time Frame</th><th>CH1</th><th>CH2</th><th>CH3</th><th>CH4</th><th>Status</th></tr>
              </thead>
              <tbody id="preview-tbody"></tbody>
            </table>
          </div>
        </div>

      </div>

    </div>

  </div>

  <div class="toast" id="toast-el"></div>

  <script>
    const chColors = {
      1: '#00e5c8',
      2: '#ffb300',
      3: '#9d4edd',
      4: '#ff357a'
    };

    const dropArea = document.getElementById('drop-area');
    const fileInput = document.getElementById('file-input');
    const progWrap = document.getElementById('prog-wrap');
    const progBar = document.getElementById('prog-bar');
    const progState = document.getElementById('prog-state');
    const progPct = document.getElementById('prog-pct');
    const placeholder = document.getElementById('placeholder');
    const content = document.getElementById('content');
    const toastEl = document.getElementById('toast-el');

    // UI Updates helpers
    function toast(msg) {
      toastEl.textContent = msg;
      toastEl.style.display = 'block';
      setTimeout(() => { toastEl.style.display = 'none'; }, 4000);
    }

    // Drag-and-drop handlers
    ['dragenter', 'dragover'].forEach(name => {
      dropArea.addEventListener(name, (e) => {
        e.preventDefault();
        dropArea.classList.add('dragover');
      }, false);
    });

    ['dragleave', 'drop'].forEach(name => {
      dropArea.addEventListener(name, (e) => {
        e.preventDefault();
        dropArea.classList.remove('dragover');
      }, false);
    });

    dropArea.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    });

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleFile(file);
    });

    function handleFile(file) {
      if (!file.name.endsWith('.csv')) {
        toast('❌ Only CSV files are supported.');
        return;
      }

      progWrap.style.display = 'block';
      progBar.style.width = '0%';
      progPct.textContent = '0%';
      progState.textContent = 'Reading file...';
      
      const reader = new FileReader();
      
      reader.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          progBar.style.width = pct + '%';
          progPct.textContent = pct + '%';
        }
      };

      reader.onload = (e) => {
        progState.textContent = 'Analyzing lines...';
        setTimeout(() => {
          try {
            analyzeCSV(e.target.result);
            progWrap.style.display = 'none';
            toast('✅ CSV analyzed successfully!');
          } catch (err) {
            console.error(err);
            progWrap.style.display = 'none';
            toast('❌ Error parsing CSV file.');
          }
        }, 100);
      };

      reader.onerror = () => {
        progWrap.style.display = 'none';
        toast('❌ Error reading file.');
      };

      reader.readAsText(file);
    }

    function analyzeCSV(text) {
      const lines = text.split('\n');
      let headerLine = '';
      const metadata = {};
      const dataRows = [];

      // 1. Extract metadata and locate the header line
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        if (line.startsWith('#')) {
          const parts = line.substring(1).split('|');
          parts.forEach(p => {
            const kv = p.split('=');
            if (kv.length === 2) {
              metadata[kv[0].trim()] = kv[1].trim();
            }
          });
          continue;
        }

        if (!headerLine) {
          headerLine = line;
          continue;
        }

        dataRows.push(line);
      }

      if (!headerLine) {
        throw new Error('No header line found');
      }

      const headers = headerLine.split(',').map(h => h.trim());
      const isLongFormat = headers.includes('channel') && (headers.includes('hw_timestamp_us') || headers.includes('timestamp'));

      // Render Metadata UI
      renderMetadata(metadata);

      if (isLongFormat) {
        processLongFormat(headers, dataRows);
      } else {
        processWideFormat(headers, dataRows, headerLine);
      }
    }

    function renderMetadata(meta) {
      const metaOut = document.getElementById('meta-output');
      const keys = Object.keys(meta);
      if (!keys.length) {
        metaOut.innerHTML = `<div style="text-align:center;color:var(--text-muted);font-size:0.8rem;padding:12px;">No comment headers found in file.</div>`;
        return;
      }

      let html = '';
      keys.forEach(k => {
        const title = k.replace(/_/g, ' ').toUpperCase();
        html += `
          <div class="meta-item">
            <span class="meta-lbl">${title}</span>
            <span class="meta-val">${meta[k]}</span>
          </div>
        `;
      });
      metaOut.innerHTML = html;
    }

    function processWideFormat(headers, dataRows, headerLine) {
      // Find muscle columns indices
      const muscleColIndices = [];
      const muscleColNames = [];
      headers.forEach((h, idx) => {
        const name = h.toLowerCase();
        if (name !== 'datetime_local' && (name.includes('muscle') || name.includes('ch') || name.includes('mv') || name.includes('rf') || name.includes('bf') || name.includes('gas') || name.includes('ta'))) {
          muscleColIndices.push(idx);
          muscleColNames.push(h);
        }
      });

      const colCounts = {}; // colIdx -> non-empty valid numbers
      const parsedData = [];

      dataRows.forEach(line => {
        const cells = line.split(',');
        if (cells.length < headers.length) return;
        parsedData.push(cells);

        muscleColIndices.forEach(idx => {
          const val = cells[idx];
          if (val !== undefined && val !== '' && val !== 'NaN' && !isNaN(parseFloat(val))) {
            colCounts[idx] = (colCounts[idx] || 0) + 1;
          }
        });
      });

      const totalFrames = parsedData.length;
      
      // Determine active columns (those with at least 1 sample)
      const activeIndices = muscleColIndices.filter(idx => (colCounts[idx] || 0) > 0);
      const activeChannels = activeIndices.map(idx => {
        const name = headers[idx];
        const match = name.match(/muscle(\d+)|ch(\d+)/i);
        return match ? parseInt(match[1] || match[2], 10) : idx;
      });

      let alignedRowsCount = 0;
      parsedData.forEach(cells => {
        const isAligned = activeIndices.every(idx => {
          const val = cells[idx];
          return val !== undefined && val !== '' && val !== 'NaN' && !isNaN(parseFloat(val));
        });
        if (isAligned) alignedRowsCount++;
      });

      const alignedPct = totalFrames > 0 ? Math.round((alignedRowsCount / totalFrames) * 1000) / 10 : 0;

      // Update basic details
      document.getElementById('out-pct').textContent = alignedPct + '%';
      document.getElementById('out-total').textContent = totalFrames;
      document.getElementById('out-aligned').textContent = alignedRowsCount;
      document.getElementById('out-channels').textContent = activeChannels.length;
      document.getElementById('out-format').textContent = 'Wide (Time-Aligned)';

      updateVerdict(alignedPct);

      // Render Channel coverage meters
      const metersList = document.getElementById('channels-meters-list');
      let metersHtml = '';
      activeIndices.forEach((idx, i) => {
        const chNum = activeChannels[i];
        const count = colCounts[idx] || 0;
        const pct = totalFrames > 0 ? Math.round((count / totalFrames) * 100) : 0;
        const color = chColors[chNum] || '#4d9fff';
        
        metersHtml += `
          <div class="channel-meter-row">
            <div class="channel-meter-info">
              <span class="channel-meter-name">${headers[idx]}</span>
              <span>${count} samples (${pct}%)</span>
            </div>
            <div class="channel-meter-bg">
              <div class="channel-meter-bar" style="width:${pct}%;background:${color};"></div>
            </div>
          </div>
        `;
      });
      metersList.innerHTML = metersHtml;

      // Render Row preview
      const thead = document.getElementById('preview-thead');
      let theadHtml = '<tr><th>Timestamp / Date</th>';
      activeIndices.forEach(idx => {
        theadHtml += `<th>${headers[idx]}</th>`;
      });
      theadHtml += '<th>Status</th></tr>';
      thead.innerHTML = theadHtml;

      const tbody = document.getElementById('preview-tbody');
      let tbodyHtml = '';
      const limit = Math.min(parsedData.length, 10);
      
      for (let i = 0; i < limit; i++) {
        const cells = parsedData[i];
        const isAligned = activeIndices.every(idx => {
          const val = cells[idx];
          return val !== undefined && val !== '' && val !== 'NaN' && !isNaN(parseFloat(val));
        });

        tbodyHtml += `<tr class="${isAligned ? '' : 'unaligned'}">`;
        // first cell is datetime
        tbodyHtml += `<td>${cells[0] || '—'}</td>`;
        
        activeIndices.forEach(idx => {
          const val = cells[idx];
          const displayVal = (val === undefined || val === '' || val === 'NaN') ? 'NaN' : parseFloat(val).toFixed(2);
          tbodyHtml += `<td>${displayVal}</td>`;
        });

        tbodyHtml += `<td>${isAligned ? '<span class="badge-ok">ALIGNED</span>' : '<span class="badge-fail">MISSED</span>'}</td>`;
        tbodyHtml += '</tr>';
      }
      tbody.innerHTML = tbodyHtml;

      placeholder.style.display = 'none';
      content.style.display = 'flex';
    }

    function processLongFormat(headers, dataRows) {
      const tsIdx = headers.findIndex(h => h.includes('timestamp') || h.includes('ts_us') || h.includes('hw_timestamp'));
      const chIdx = headers.findIndex(h => h === 'channel' || h === 'ch');
      const valIdx = headers.findIndex(h => h.includes('mv') || h.includes('value'));
      const muscleIdx = headers.findIndex(h => h === 'muscle');

      const tsMap = {}; // ts -> Set of channels
      const channelCounts = {}; // channel -> sample count
      const channelMuscleNames = {}; // channel -> muscle name

      dataRows.forEach(line => {
        const cells = line.split(',');
        if (cells.length < headers.length) return;

        const tsVal = cells[tsIdx]?.trim();
        const chVal = cells[chIdx]?.trim();
        const rawVal = cells[valIdx]?.trim();
        
        if (!tsVal || !chVal || rawVal === '' || rawVal === 'NaN' || isNaN(parseFloat(rawVal))) return;

        const ts = parseInt(tsVal, 10);
        const ch = parseInt(chVal, 10);
        if (isNaN(ts) || isNaN(ch)) return;

        channelCounts[ch] = (channelCounts[ch] || 0) + 1;
        if (muscleIdx !== -1 && cells[muscleIdx]) {
          channelMuscleNames[ch] = cells[muscleIdx].trim();
        }

        if (!tsMap[ts]) {
          tsMap[ts] = new Set();
        }
        tsMap[ts].add(ch);
      });

      const uniqueTimestamps = Object.keys(tsMap).map(Number).sort((a, b) => a - b);
      const totalFrames = uniqueTimestamps.length;
      const activeChannels = Object.keys(channelCounts).map(Number).sort((a, b) => a - b);

      let alignedRowsCount = 0;
      uniqueTimestamps.forEach(ts => {
        const chSet = tsMap[ts];
        const isAligned = activeChannels.every(ch => chSet.has(ch));
        if (isAligned) alignedRowsCount++;
      });

      const alignedPct = totalFrames > 0 ? Math.round((alignedRowsCount / totalFrames) * 1000) / 10 : 0;

      // Update details UI
      document.getElementById('out-pct').textContent = alignedPct + '%';
      document.getElementById('out-total').textContent = totalFrames;
      document.getElementById('out-aligned').textContent = alignedRowsCount;
      document.getElementById('out-channels').textContent = activeChannels.length;
      document.getElementById('out-format').textContent = 'Long (Stacked)';

      updateVerdict(alignedPct);

      // Render Channel coverage meters
      const metersList = document.getElementById('channels-meters-list');
      let metersHtml = '';
      activeChannels.forEach(ch => {
        const count = channelCounts[ch] || 0;
        const pct = totalFrames > 0 ? Math.round((count / totalFrames) * 100) : 0;
        const label = channelMuscleNames[ch] ? `Channel ${ch} (${channelMuscleNames[ch]})` : `Channel ${ch}`;
        const color = chColors[ch] || '#4d9fff';

        metersHtml += `
          <div class="channel-meter-row">
            <div class="channel-meter-info">
              <span class="channel-meter-name">${label}</span>
              <span>${count} samples (${pct}%)</span>
            </div>
            <div class="channel-meter-bg">
              <div class="channel-meter-bar" style="width:${pct}%;background:${color};"></div>
            </div>
          </div>
        `;
      });
      metersList.innerHTML = metersHtml;

      // Render Row preview for Long Stacked format (first 10 unique hardware timestamps)
      const thead = document.getElementById('preview-thead');
      let theadHtml = '<tr><th>HW Timestamp (us)</th>';
      activeChannels.forEach(ch => {
        theadHtml += `<th>CH${ch}</th>`;
      });
      theadHtml += '<th>Status</th></tr>';
      thead.innerHTML = theadHtml;

      const tbody = document.getElementById('preview-tbody');
      let tbodyHtml = '';
      const limit = Math.min(uniqueTimestamps.length, 10);

      // We need to scan dataRows to associate values for the first 10 timestamps
      const tsValues = {}; // ts -> ch -> value
      uniqueTimestamps.slice(0, limit).forEach(ts => {
        tsValues[ts] = {};
      });

      dataRows.forEach(line => {
        const cells = line.split(',');
        if (cells.length < headers.length) return;
        const ts = parseInt(cells[tsIdx], 10);
        if (tsValues[ts]) {
          const ch = parseInt(cells[chIdx], 10);
          const val = parseFloat(cells[valIdx]);
          if (!isNaN(ch) && !isNaN(val)) {
            tsValues[ts][ch] = val;
          }
        }
      });

      for (let i = 0; i < limit; i++) {
        const ts = uniqueTimestamps[i];
        const chVals = tsValues[ts] || {};
        const isAligned = activeChannels.every(ch => chVals[ch] !== undefined);

        tbodyHtml += `<tr class="${isAligned ? '' : 'unaligned'}">`;
        tbodyHtml += `<td>${ts}</td>`;

        activeChannels.forEach(ch => {
          const val = chVals[ch];
          tbodyHtml += `<td>${val !== undefined ? val.toFixed(2) : 'NaN'}</td>`;
        });

        tbodyHtml += `<td>${isAligned ? '<span class="badge-ok">ALIGNED</span>' : '<span class="badge-fail">MISSED</span>'}</td>`;
        tbodyHtml += '</tr>';
      }
      tbody.innerHTML = tbodyHtml;

      placeholder.style.display = 'none';
      content.style.display = 'flex';
    }

    function updateVerdict(pct) {
      const verdict = document.getElementById('out-verdict');
      const statMain = verdict.parentElement;
      if (pct >= 95) {
        verdict.textContent = 'Excellent Sync';
        verdict.style.color = 'var(--accent-green)';
        statMain.style.borderColor = 'rgba(0, 229, 160, 0.2)';
      } else if (pct >= 80) {
        verdict.textContent = 'Good Sync';
        verdict.style.color = 'var(--accent-yellow)';
        statMain.style.borderColor = 'rgba(255, 179, 0, 0.2)';
      } else {
        verdict.textContent = 'Poor Sync';
        verdict.style.color = 'var(--accent-red)';
        statMain.style.borderColor = 'rgba(255, 77, 77, 0.2)';
      }
    }
  </script>
</body>
</html>
