/**
 * serial-web.js
 * Web Serial API — browser talks directly to ESP32 (no Python backend).
 * Pattern inspired by Google Chrome Labs Serial Terminal.
 */
'use strict';

const SerialWeb = {
  port: null,
  _reader: null,
  _reading: false,
  connected: false,
  baud: 921600,

  stats: {
    rx_packets: 0,
    rx_errors: 0,
    bytes_received: 0,
  },

  onConnect: null,
  onDisconnect: null,
  onError: null,

  /** Web Serial requires HTTPS (or localhost). */
  isSupported() {
    const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
    if (isAndroid) return true; // Pretend supported so we let Android users try
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  },

  /** Human-readable browser support message. */
  supportMessage() {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    if (/Android/i.test(ua)) {
      return null; // Do not show warning for Android, let them try
    }
    if (this.isSupported()) return null;
    if (/iPhone|iPad|iPod/i.test(ua)) {
      return 'Web Serial is not available on iOS. Use Chrome or Edge on a laptop/desktop with USB.';
    }
    return 'Use Chrome, Edge, or Opera on desktop. Firefox and Safari do not support Web Serial.';
  },

  /** Ports the user already granted for this site. */
  async getGrantedPorts() {
    if (typeof navigator === 'undefined' || !navigator.serial) return [];
    return navigator.serial.getPorts();
  },

  /**
   * Open serial port. If `existingPort` is omitted, shows the browser port picker.
   * Must be called from a user gesture (button click).
   */
  async connect(baudRate = 921600, existingPort = null) {
    if (typeof navigator === 'undefined' || !navigator.serial) {
      throw new Error('Web Serial API is not available in this browser. Try Chrome on Android with OTG, or enable the experimental Web Serial API flag.');
    }
    if (this.connected) await this.disconnect();

    this.baud = baudRate;
    const port = existingPort || await navigator.serial.requestPort();
    await port.open({
      baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none',
    });

    // De-assert DTR/RTS so ESP32 doesn't reset (matches Python backend)
    try {
      await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    } catch { /* not all platforms support setSignals */ }

    await this._sleep(2000);

    this.port = port;
    this.connected = true;
    this.stats = { rx_packets: 0, rx_errors: 0, bytes_received: 0 };

    this._startReadLoop();

    if (this.onConnect) this.onConnect();
    if (window.EmgEngine) {
      EmgEngine.setStats(this.stats);
      EmgEngine.setConnected(true);
      EmgEngine.startBroadcast();
    }

    return port;
  },

  /** Reconnect to a previously granted port (no picker). */
  async reconnectGranted(baudRate = 921600) {
    const ports = await this.getGrantedPorts();
    if (!ports.length) return false;
    await this.connect(baudRate, ports[0]);
    return true;
  },

  async disconnect() {
    this._reading = false;
    this.connected = false;

    if (this._reader) {
      try { await this._reader.cancel(); } catch { /* */ }
      try { this._reader.releaseLock(); } catch { /* */ }
      this._reader = null;
    }

    if (this.port) {
      try { await this.port.close(); } catch { /* */ }
      this.port = null;
    }

    if (window.EmgEngine) {
      EmgEngine.setConnected(false);
      EmgEngine.setStats(this.stats);
    }

    if (this.onDisconnect) this.onDisconnect();
  },

  async _startReadLoop() {
    if (!this.port?.readable) return;

    this._reading = true;
    this._reader = this.port.readable.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (this._reading) {
        const { value, done } = await this._reader.read();
        if (done) break;
        if (!value) continue;

        this.stats.bytes_received += value.length;
        buffer += decoder.decode(value, { stream: true });

        let nl;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;

          try {
            const packet = JSON.parse(line);
            const rxPerf = performance.now();
            this.stats.rx_packets++;
            if (window.EmgEngine) {
              EmgEngine.setStats(this.stats);
              EmgEngine.onPacket(packet, rxPerf);
            }
          } catch {
            this.stats.rx_errors++;
            if (window.EmgEngine) EmgEngine.setStats(this.stats);
          }
        }
      }
    } catch (err) {
      if (this._reading && this.onError) this.onError(err);
    } finally {
      if (this._reader) {
        try { this._reader.releaseLock(); } catch { /* */ }
        this._reader = null;
      }
      if (this.connected) {
        this.connected = false;
        if (window.EmgEngine) EmgEngine.setConnected(false);
        if (this.onDisconnect) this.onDisconnect();
      }
    }
  },

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },
};

window.SerialWeb = SerialWeb;

// Auto-reconnect if user already granted a port on this origin
document.addEventListener('DOMContentLoaded', () => {
  if (!SerialWeb.isSupported() || !window.EmgEngine) return;
  EmgEngine.startBroadcast();
});
