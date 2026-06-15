"""
data_manager.py
---------------
Central in-memory store for EMG channel data.
Processes raw packets from SerialManager, computes signal metrics,
and provides snapshot data to the WebSocket broadcaster.
"""

import logging
import math
import threading
import time
from collections import deque
from typing import Optional

from signal_processor import FilterBank

logger = logging.getLogger(__name__)

# Slave index → channel number (1-based)
SLAVE_TO_CHANNEL: dict[int, int] = {
    0: 1,
    1: 2,
    2: 3,
    3: 4,
}

# Maximum samples to keep per channel in the rolling buffer (~5 s @ ~1 kHz)
MAX_BUFFER_SAMPLES = 5000

# Samples sent per WebSocket broadcast (last N)
BROADCAST_SAMPLES = 500


class ChannelData:
    """Holds rolling sample buffer and computed metrics for one EMG channel."""

    def __init__(self, channel_id: int) -> None:
        self.channel_id = channel_id
        self.buffer: deque[float] = deque(maxlen=MAX_BUFFER_SAMPLES)
        self.lock = threading.Lock()

        # Latest computed metrics
        self.rms: float = 0.0
        self.mean: float = 0.0
        self.peak: float = 0.0
        self.peak_to_peak: float = 0.0
        self.sample_rate: float = 0.0  # estimated Hz

        # For sampling-rate estimation
        self._last_packet_time: Optional[float] = None
        self._packet_count: int = 0
        self._sample_count: int = 0
        self._rate_window_start: float = time.monotonic()

    # ------------------------------------------------------------------

    def ingest(self, samples: list[float]) -> None:
        """Add new samples and recompute metrics."""
        with self.lock:
            self.buffer.extend(samples)
            self._sample_count += len(samples)
            self._packet_count += 1
            now = time.monotonic()

            # Estimate sample rate every second
            elapsed = now - self._rate_window_start
            if elapsed >= 1.0:
                self.sample_rate = self._sample_count / elapsed
                self._sample_count = 0
                self._rate_window_start = now

            self._compute_metrics()

    def _compute_metrics(self) -> None:
        """Compute RMS, mean, peak, and peak-to-peak from current buffer."""
        if not self.buffer:
            return

        data = list(self.buffer)
        n = len(data)

        total = sum(data)
        self.mean = total / n

        sum_sq = sum(x * x for x in data)
        self.rms = math.sqrt(sum_sq / n)

        self.peak = max(data)
        self.peak_to_peak = max(data) - min(data)

    def snapshot(self) -> dict:
        """Return a JSON-serialisable snapshot for broadcasting."""
        with self.lock:
            samples = list(self.buffer)[-BROADCAST_SAMPLES:]
            return {
                "ch": self.channel_id,
                "rms": round(self.rms, 2),
                "mean": round(self.mean, 2),
                "peak": round(self.peak, 2),
                "peak_to_peak": round(self.peak_to_peak, 2),
                "sample_rate": round(self.sample_rate, 1),
                "samples": samples,
            }


class DataManager:
    """
    Aggregates data across all four EMG channels.
    Receives packets from SerialManager, optionally denoises them via
    FilterBank, and exposes channel snapshots for broadcasting.
    """

    def __init__(self) -> None:
        self._channels: dict[int, ChannelData] = {
            ch: ChannelData(ch) for ch in range(1, 5)
        }
        self._lock = threading.Lock()
        self.last_packet_time: Optional[float] = None
        self._filter_bank = FilterBank(n_channels=4)

    # ------------------------------------------------------------------
    # Packet ingestion
    # ------------------------------------------------------------------

    def on_packet(self, packet: dict) -> None:
        """
        Process a decoded JSON packet from the ESP32.

        Expected format::

            {
                "slave": 1,
                "t0": 213978,
                "dt_us": 1000,
                "mv": [3087, 3084, ...]
            }
        """
        try:
            slave  = int(packet.get("slave", -1))
            mv: list = packet.get("mv", [])
            dt_us  = int(packet.get("dt_us", 1000))

            channel_id = SLAVE_TO_CHANNEL.get(slave)
            if channel_id is None:
                logger.debug("Unknown slave id: %d", slave)
                return

            if not isinstance(mv, list):
                logger.debug("Invalid 'mv' field: %r", mv)
                return

            samples = [round((int(v) / 4095.0) * 3300.0, 1) for v in mv]

            # Update per-channel sample rate in the filter bank
            if dt_us > 0:
                fs = 1_000_000.0 / dt_us
                self._filter_bank.update_fs(channel_id, fs)

            # Apply denoising filter (bandpass 20-450 Hz + 50 Hz notch)
            samples = self._filter_bank.process(channel_id, samples)

            self._channels[channel_id].ingest(samples)
            self.last_packet_time = time.monotonic()

        except (ValueError, TypeError, KeyError) as exc:
            logger.warning("Packet processing error: %s | packet=%r", exc, packet)

    # ------------------------------------------------------------------
    # Filter control
    # ------------------------------------------------------------------

    @property
    def filter_enabled(self) -> bool:
        """Whether the denoising filter is currently active."""
        return self._filter_bank.enabled

    @filter_enabled.setter
    def filter_enabled(self, value: bool) -> None:
        self._filter_bank.enabled = value

    def reset_filters(self) -> None:
        """Reset all filter states (zi). Call when starting a new recording."""
        self._filter_bank.reset_all()

    # ------------------------------------------------------------------
    # Snapshot for broadcasting
    # ------------------------------------------------------------------

    def get_snapshot(self) -> list[dict]:
        """Return snapshots for all four channels."""
        return [ch.snapshot() for ch in self._channels.values()]

    def get_channel(self, channel_id: int) -> Optional[ChannelData]:
        return self._channels.get(channel_id)
