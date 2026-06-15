"""
recorder.py
-----------
Records EMG samples and exports a PARALLEL wide-format CSV.

Column layout (only active channels are included):
    sample_index, rel_time_ms, ts_ch1_us, ch1, ts_ch2_us, ch2, ...

Alignment strategy
------------------
Each packet carries samples for one slave/channel.  We store them as
(timestamp_us, value) pairs in per-channel lists.  On export the row
index i directly maps each channel's i-th sample into the same row,
so CH1[i] and CH2[i] are always side-by-side — never in series.

The `rel_time_ms` column is computed from the median inter-sample
interval reported by the hardware, giving a clean shared time axis
for plotting both channels together.
"""

import csv
import io
import logging
import threading
from collections import defaultdict

from data_manager import SLAVE_TO_CHANNEL
from signal_processor import ChannelFilter

logger = logging.getLogger(__name__)


class Recorder:
    """
    Thread-safe EMG recorder that stores samples in a wide row-per-sample table,
    aligned by per-channel packet sequence number.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._recording = False

        # Session metadata
        self._label:       str   = "testing"
        self._participant: str   = "testing"
        self._weight_kg:   float = 70.0
        self._height_cm:   float = 170.0

        # Per-channel storage: list of (timestamp_us, value)
        # Index in the list = sample sequence number for that channel
        self._ch_samples: dict[int, list[tuple[int, float]]] = {
            1: [], 2: [], 3: [], 4: []
        }
        # Per-channel measured inter-sample interval (µs) — used for offline filter
        self._ch_dt_us: dict[int, float] = {1: 1000.0, 2: 1000.0, 3: 1000.0, 4: 1000.0}
        self._total_samples: int = 0

    # ------------------------------------------------------------------
    # Control
    # ------------------------------------------------------------------

    def start(
        self,
        label:       str   = "testing",
        participant: str   = "testing",
        weight_kg:   float = 70.0,
        height_cm:   float = 170.0,
    ) -> None:
        with self._lock:
            self._ch_samples = {1: [], 2: [], 3: [], 4: []}
            self._total_samples = 0
            self._label       = label.strip()       or "testing"
            self._participant = participant.strip()  or "testing"
            self._weight_kg   = weight_kg
            self._height_cm   = height_cm
            self._recording   = True
        logger.info(
            "Recording started. participant=%s label=%s weight=%.1f height=%.1f",
            self._participant, self._label, self._weight_kg, self._height_cm,
        )

    def stop(self) -> None:
        with self._lock:
            self._recording = False
        logger.info("Recording stopped. %d total samples.", self._total_samples)

    @property
    def label(self) -> str:
        return self._label

    @property
    def participant(self) -> str:
        return self._participant

    @property
    def is_recording(self) -> bool:
        return self._recording

    @property
    def sample_count(self) -> int:
        with self._lock:
            return self._total_samples

    # ------------------------------------------------------------------
    # Ingestion
    # ------------------------------------------------------------------

    def record_packet(self, packet: dict) -> None:
        """
        Ingest one ESP32 JSON packet.

        Keys used:
          slave  → channel number (via SLAVE_TO_CHANNEL)
          t0     → start timestamp µs
          dt_us  → inter-sample interval µs
          mv     → list of ADC values
        """
        if not self._recording:
            return

        try:
            slave = int(packet.get("slave", -1))
            t0    = int(packet.get("t0",    0))
            dt_us = int(packet.get("dt_us", 1000))
            mv    = packet.get("mv", [])

            channel = SLAVE_TO_CHANNEL.get(slave)
            if channel is None or not isinstance(mv, list) or not mv:
                return

            with self._lock:
                # Track inter-sample interval for offline filter fs
                if dt_us > 0:
                    self._ch_dt_us[channel] = float(dt_us)

                for i, val in enumerate(mv):
                    ts = t0 + i * dt_us
                    mv_val = round((int(val) / 4095.0) * 3300.0, 1)
                    self._ch_samples[channel].append((ts, mv_val))
                    self._total_samples += 1

        except (ValueError, TypeError, KeyError) as exc:
            logger.warning("Recorder packet error: %s", exc)

    # ------------------------------------------------------------------
    # Export
    # ------------------------------------------------------------------

    def to_csv_bytes(self, apply_filter: bool = True) -> bytes:
        """
        Export a parallel wide-format CSV where every row corresponds to
        the same sample index across all active channels.

        Columns
        -------
        sample_index   – 0-based row counter
        rel_time_ms    – relative time computed from median dt across
                         active channels (gives a shared x-axis for plots)
        ts_ch{N}_us    – hardware timestamp µs for channel N (active only)
        ch{N}          – ADC value in mV for channel N (active only)

        Empty / inactive channels (no samples recorded) are omitted so the
        CSV is clean when only 2 of 4 channels are used.

        Parameters
        ----------
        apply_filter : bool
            If True (default), applies zero-phase offline filtering
            (sosfiltfilt: bandpass 20–450 Hz + 50 Hz notch) to each channel
            before writing — best quality for analysis.
            Pass False to export raw ADC-converted values.
        """
        with self._lock:
            # Snapshot under lock
            ch    = {k: list(v) for k, v in self._ch_samples.items()}
            dt_us = dict(self._ch_dt_us)

        # Determine which channels actually have data
        active = [c for c in [1, 2, 3, 4] if ch[c]]
        if not active:
            return b"sample_index,rel_time_ms\n"

        n_rows = max(len(ch[c]) for c in active)

        # Estimate median inter-sample interval (µs) across all active channels
        dt_estimates: list[float] = []
        for c in active:
            samples = ch[c]
            if len(samples) >= 2:
                diffs = [
                    samples[j][0] - samples[j - 1][0]
                    for j in range(1, min(len(samples), 20))
                    if samples[j][0] > samples[j - 1][0]
                ]
                if diffs:
                    dt_estimates.append(sum(diffs) / len(diffs))
        median_dt_us = sum(dt_estimates) / len(dt_estimates) if dt_estimates else 1000.0

        # Optionally apply zero-phase offline filter per channel
        ch_values: dict[int, list[float]] = {}
        for c in active:
            raw_vals = [v for _, v in ch[c]]
            if apply_filter:
                fs = 1_000_000.0 / dt_us.get(c, 1000.0)
                filtered = ChannelFilter.apply_offline(raw_vals, fs=fs)
                ch_values[c] = filtered
            else:
                ch_values[c] = raw_vals

        output = io.StringIO()
        writer = csv.writer(output)

        # Header: sample_index, rel_time_ms, then per-channel ts+value pairs
        filter_note = "filtered" if apply_filter else "raw"
        header = ["participant", "weight_kg", "height_cm", "label", "sample_index", "rel_time_ms"]
        for c in active:
            header += [f"ts_ch{c}_us", f"ch{c}_{filter_note}"]
        writer.writerow(header)

        for i in range(n_rows):
            rel_time_ms = round(i * median_dt_us / 1000.0, 3)
            row: list = [
                self._participant, self._weight_kg, self._height_cm,
                self._label, i, rel_time_ms,
            ]
            for c in active:
                ts_us = ch[c][i][0] if i < len(ch[c]) else ""
                val   = round(ch_values[c][i], 2) if i < len(ch_values[c]) else ""
                row += [ts_us, val]
            writer.writerow(row)

        return output.getvalue().encode("utf-8")

    def clear(self) -> None:
        with self._lock:
            self._ch_samples   = {1: [], 2: [], 3: [], 4: []}
            self._total_samples = 0
            self._label        = "testing"
            self._participant  = "testing"
            self._weight_kg    = 70.0
            self._height_cm    = 170.0
            self._recording    = False
        logger.info("Recording cleared.")
