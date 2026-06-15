"""
signal_processor.py
-------------------
Digital filter bank for MyoWare 2.0 RAW EMG signal denoising.

Noise sources addressed
-----------------------
  1. Motion artifact / baseline wander  : removed by 20 Hz high-pass
  2. Power-line interference (50 Hz)    : removed by narrow IIR notch (Q=35)
  3. High-frequency thermal / EMI noise : removed by 450 Hz low-pass
  4. Wiring / capacitive coupling       : attenuated by combined bandpass

Two operating modes
-------------------
  * Streaming  (real-time display) — sosfilt with maintained zi state across
    packets; zero discontinuity at packet boundaries, very low latency.
  * Offline (CSV export)           — sosfiltfilt; zero-phase (no phase lag),
    ideal for analysis of recorded data.
"""

import logging
import threading

import numpy as np
from scipy import signal as sp_signal

logger = logging.getLogger(__name__)

# ── Filter Design Parameters ───────────────────────────────────────────────────
_DEFAULT_FS    = 1000.0   # Hz — nominal MyoWare 2.0 / ESP32 sample rate
_BP_LOW_HZ     = 20.0     # Hz — lower EMG cutoff (removes motion artifacts)
_BP_HIGH_HZ    = 450.0    # Hz — upper EMG cutoff (removes HF electrical noise)
_BP_ORDER      = 4        # Butterworth order (higher = steeper roll-off)
_NOTCH_FREQ_HZ = 50.0     # Hz — mains frequency (India / Europe)
_NOTCH_Q       = 35.0     # Notch Q factor: higher = narrower / sharper


# ──────────────────────────────────────────────────────────────────────────────

class ChannelFilter:
    """
    Stateful two-stage filter chain for a single EMG channel.

    Stage 1 — Butterworth bandpass (20–450 Hz, order 4, SOS form)
    Stage 2 — IIR notch at 50 Hz (Q=35, ≈1.4 Hz −3 dB bandwidth)

    The filter state (zi) is maintained between streaming packet calls so
    there are no discontinuities at packet boundaries.
    """

    def __init__(self, fs: float = _DEFAULT_FS) -> None:
        self._lock = threading.Lock()
        self.fs = fs
        self.enabled = True
        self._initialized = False
        self._build_filters()

    # ------------------------------------------------------------------
    # Filter construction
    # ------------------------------------------------------------------

    def _build_filters(self) -> None:
        fs  = self.fs
        nyq = fs / 2.0

        # ── Stage 1: Butterworth Bandpass ─────────────────────────────
        lo = _BP_LOW_HZ  / nyq
        hi = min(_BP_HIGH_HZ / nyq, 0.98)   # must stay below Nyquist
        self._bp_sos = sp_signal.butter(
            _BP_ORDER, [lo, hi], btype="bandpass", output="sos"
        )
        self._bp_zi = sp_signal.sosfilt_zi(self._bp_sos)   # shape (n_sec, 2)

        # ── Stage 2: IIR Notch at mains frequency ─────────────────────
        b_n, a_n        = sp_signal.iirnotch(_NOTCH_FREQ_HZ, _NOTCH_Q, fs=fs)
        self._notch_sos  = sp_signal.tf2sos(b_n, a_n)
        self._notch_zi   = sp_signal.sosfilt_zi(self._notch_sos)

        self._initialized = False
        logger.debug(
            "ChannelFilter built @ %.0f Hz | bandpass %.0f–%.0f Hz | notch %.0f Hz",
            fs, _BP_LOW_HZ, _BP_HIGH_HZ, _NOTCH_FREQ_HZ,
        )

    # ------------------------------------------------------------------
    # State management
    # ------------------------------------------------------------------

    def reset(self) -> None:
        """Reset filter state — call at the start of each recording session."""
        with self._lock:
            self._bp_zi      = sp_signal.sosfilt_zi(self._bp_sos)
            self._notch_zi   = sp_signal.sosfilt_zi(self._notch_sos)
            self._initialized = False

    def update_fs(self, fs: float) -> None:
        """Rebuild filters if the measured sample rate differs by > 5 %."""
        if abs(fs - self.fs) / max(self.fs, 1.0) > 0.05:
            with self._lock:
                self.fs = fs
                self._build_filters()
            logger.info("ChannelFilter rebuilt for %.0f Hz", fs)

    # ------------------------------------------------------------------
    # Streaming filter (for live display)
    # ------------------------------------------------------------------

    def process(self, samples: list[float]) -> list[float]:
        """
        Filter a streaming batch of samples in real time.

        Maintains zi state between calls so there are no jumps at packet
        boundaries. Returns a list of the same length.
        """
        if not self.enabled or len(samples) < 2:
            return samples

        x = np.asarray(samples, dtype=np.float64)

        with self._lock:
            # On first call, seed zi to reduce startup transient
            if not self._initialized:
                bp_zi    = self._bp_zi    * x[0]
                notch_zi = self._notch_zi * x[0]
                self._initialized = True
            else:
                bp_zi    = self._bp_zi
                notch_zi = self._notch_zi

            # Stage 1 — bandpass
            x, self._bp_zi = sp_signal.sosfilt(self._bp_sos, x, zi=bp_zi)

            # Stage 2 — notch
            x, self._notch_zi = sp_signal.sosfilt(
                self._notch_sos, x, zi=notch_zi
            )

        return x.tolist()

    # ------------------------------------------------------------------
    # Offline / zero-phase filter (for CSV export)
    # ------------------------------------------------------------------

    @staticmethod
    def apply_offline(
        samples: list[float],
        fs: float = _DEFAULT_FS,
    ) -> list[float]:
        """
        Zero-phase offline filter using sosfiltfilt.

        Processes the entire array at once with no phase lag — ideal for
        analysis of recorded data. Requires ≥ 27 samples (3× padlen).
        """
        if len(samples) < 27:
            return samples

        x = np.asarray(samples, dtype=np.float64)
        nyq = fs / 2.0

        # Stage 1 — bandpass
        lo = _BP_LOW_HZ / nyq
        hi = min(_BP_HIGH_HZ / nyq, 0.98)
        bp_sos = sp_signal.butter(_BP_ORDER, [lo, hi],
                                   btype="bandpass", output="sos")
        x = sp_signal.sosfiltfilt(bp_sos, x)

        # Stage 2 — notch
        b_n, a_n  = sp_signal.iirnotch(_NOTCH_FREQ_HZ, _NOTCH_Q, fs=fs)
        notch_sos = sp_signal.tf2sos(b_n, a_n)
        x = sp_signal.sosfiltfilt(notch_sos, x)

        return x.tolist()


# ──────────────────────────────────────────────────────────────────────────────

class FilterBank:
    """
    Manages one ChannelFilter per EMG channel.
    Provides global enable / disable and per-channel sample-rate updates.
    Thread-safe.
    """

    def __init__(self, n_channels: int = 4, fs: float = _DEFAULT_FS) -> None:
        self._filters: dict[int, ChannelFilter] = {
            ch: ChannelFilter(fs) for ch in range(1, n_channels + 1)
        }
        self._enabled = True

    # ------------------------------------------------------------------

    @property
    def enabled(self) -> bool:
        return self._enabled

    @enabled.setter
    def enabled(self, value: bool) -> None:
        self._enabled = value
        for f in self._filters.values():
            f.enabled = value
        logger.info("FilterBank %s", "enabled" if value else "disabled")

    # ------------------------------------------------------------------

    def process(self, channel_id: int, samples: list[float]) -> list[float]:
        """Filter samples for the given channel (streaming mode)."""
        f = self._filters.get(channel_id)
        return f.process(samples) if f else samples

    def reset_channel(self, channel_id: int) -> None:
        f = self._filters.get(channel_id)
        if f:
            f.reset()

    def reset_all(self) -> None:
        for f in self._filters.values():
            f.reset()

    def update_fs(self, channel_id: int, fs: float) -> None:
        f = self._filters.get(channel_id)
        if f:
            f.update_fs(fs)
