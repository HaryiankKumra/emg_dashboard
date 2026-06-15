"""
recorder.py
-----------
Records EMG samples and exports timestamp-aligned wide-format CSV.

Alignment uses hardware timestamps (t0 in milliseconds from ESP32 JSON)
or frame_id when present — never arbitrary sample index pairing.
"""

import csv
import io
import logging
import threading
from bisect import bisect_left

from data_manager import SLAVE_TO_CHANNEL
from signal_processor import ChannelFilter

logger = logging.getLogger(__name__)


def _packet_t0_us(packet: dict) -> int:
    if "t0_us" in packet:
        return int(packet["t0_us"])
    if "t0_ms" in packet:
        return int(packet["t0_ms"]) * 1000
    # hardware.tex: JSON t0 field is milliseconds
    return int(packet.get("t0", 0)) * 1000


def _estimate_median_dt_us(ch_samples: dict[int, list], active: list[int]) -> float:
    estimates: list[float] = []
    for c in active:
        samples = ch_samples[c]
        if len(samples) < 2:
            continue
        diffs = []
        for j in range(1, min(len(samples), 50)):
            d = samples[j][0] - samples[j - 1][0]
            if d > 0:
                diffs.append(d)
        if diffs:
            diffs.sort()
            estimates.append(diffs[len(diffs) // 2])
    return sum(estimates) / len(estimates) if estimates else 1000.0


def _nearest_sample(samples: list[tuple[int, float]], target_ts: int, tolerance: float):
    if not samples:
        return None
    ts_list = [s[0] for s in samples]
    i = bisect_left(ts_list, target_ts)
    candidates = []
    if i > 0:
        candidates.append(samples[i - 1])
    if i < len(samples):
        candidates.append(samples[i])
    best = None
    best_diff = float("inf")
    for ts, val in candidates:
        diff = abs(ts - target_ts)
        if diff < best_diff:
            best_diff = diff
            best = (ts, val)
    return best if best_diff <= tolerance else None


class Recorder:
    """Thread-safe EMG recorder with timestamp-aligned CSV export."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._recording = False
        self._label: str = "testing"
        self._participant: str = "testing"
        self._weight_kg: float = 70.0
        self._height_cm: float = 170.0
        # (timestamp_us, value_mV, sync_key|None)
        self._ch_samples: dict[int, list[tuple[int, float, int | None]]] = {
            1: [], 2: [], 3: [], 4: []
        }
        self._ch_dt_us: dict[int, float] = {1: 1000.0, 2: 1000.0, 3: 1000.0, 4: 1000.0}
        self._total_samples: int = 0

    def start(
        self,
        label: str = "testing",
        participant: str = "testing",
        weight_kg: float = 70.0,
        height_cm: float = 170.0,
    ) -> None:
        with self._lock:
            self._ch_samples = {1: [], 2: [], 3: [], 4: []}
            self._total_samples = 0
            self._label = label.strip() or "testing"
            self._participant = participant.strip() or "testing"
            self._weight_kg = weight_kg
            self._height_cm = height_cm
            self._recording = True

    def stop(self) -> None:
        with self._lock:
            self._recording = False

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

    def record_packet(self, packet: dict) -> None:
        if not self._recording:
            return
        try:
            slave = int(packet.get("slave", -1))
            t0_us = _packet_t0_us(packet)
            dt_us = int(packet.get("dt_us", 1000))
            mv = packet.get("mv", [])
            channel = SLAVE_TO_CHANNEL.get(slave)
            if channel is None or not isinstance(mv, list) or not mv:
                return

            frame_base = packet.get("frame_id", packet.get("frame_id_start", packet.get("fid")))

            with self._lock:
                if dt_us > 0:
                    self._ch_dt_us[channel] = float(dt_us)
                for i, val in enumerate(mv):
                    ts = t0_us + i * dt_us
                    mv_val = round((int(val) / 4095.0) * 3300.0, 1)
                    sync_key = int(frame_base) * 10000 + i if frame_base is not None else None
                    self._ch_samples[channel].append((ts, mv_val, sync_key))
                    self._total_samples += 1
        except (ValueError, TypeError, KeyError) as exc:
            logger.warning("Recorder packet error: %s", exc)

    def _build_aligned_rows(
        self,
        ch: dict[int, list],
        ch_values: dict[int, list[float]],
        active: list[int],
        median_dt_us: float,
    ) -> list[dict]:
        has_sync = all(
            ch[c] and all(s[2] is not None for s in ch[c])
            for c in active
        )

        if has_sync:
            keys = sorted({s[2] for c in active for s in ch[c]})
            by_key: dict[int, dict[int, tuple[int, float]]] = {c: {} for c in active}
            for c in active:
                for j, (ts, _, sk) in enumerate(ch[c]):
                    by_key[c][sk] = (ts, ch_values[c][j])

            rows = []
            for idx, key in enumerate(keys):
                cells: dict[int, tuple[int, float] | None] = {}
                ref_ts = None
                for c in active:
                    hit = by_key[c].get(key)
                    cells[c] = hit
                    if hit and ref_ts is None:
                        ref_ts = hit[0]
                rows.append({"index": idx, "ref_ts": ref_ts, "cells": cells})
            return rows

        tolerance = median_dt_us / 2
        t_min = min(ch[c][0][0] for c in active)
        t_max = max(ch[c][-1][0] for c in active)
        prepared = {
            c: [(ch[c][j][0], ch_values[c][j]) for j in range(len(ch[c]))]
            for c in active
        }

        rows = []
        idx = 0
        t = float(t_min)
        while t <= t_max + median_dt_us / 2:
            cells: dict[int, tuple[int, float] | None] = {}
            any_hit = False
            for c in active:
                hit = _nearest_sample(prepared[c], int(t), tolerance)
                cells[c] = hit
                if hit:
                    any_hit = True
            if any_hit:
                rows.append({"index": idx, "ref_ts": int(t), "cells": cells})
                idx += 1
            t += median_dt_us
        return rows

    def to_csv_bytes(self, apply_filter: bool = True) -> bytes:
        with self._lock:
            ch = {k: list(v) for k, v in self._ch_samples.items()}
            dt_us = dict(self._ch_dt_us)

        active = [c for c in [1, 2, 3, 4] if ch[c]]
        if not active:
            return b"sample_index,rel_time_ms\n"

        median_dt_us = _estimate_median_dt_us(ch, active)

        ch_values: dict[int, list[float]] = {}
        for c in active:
            raw_vals = [v for _, v, _ in ch[c]]
            if apply_filter:
                fs = 1_000_000.0 / dt_us.get(c, 1000.0)
                ch_values[c] = ChannelFilter.apply_offline(raw_vals, fs=fs)
            else:
                ch_values[c] = raw_vals

        aligned = self._build_aligned_rows(ch, ch_values, active, median_dt_us)
        t_min = aligned[0]["ref_ts"] if aligned else 0
        filter_note = "filtered" if apply_filter else "raw"

        output = io.StringIO()
        writer = csv.writer(output)
        header = [
            "participant", "weight_kg", "height_cm", "label",
            "sample_index", "ref_timestamp_us", "rel_time_ms",
        ]
        for c in active:
            header += [f"ts_ch{c}_us", f"ch{c}_{filter_note}"]
        header.append("channels_present")
        writer.writerow(header)

        for row in aligned:
            rel_time_ms = round((row["ref_ts"] - t_min) / 1000.0, 3)
            present: list[str] = []
            out_row: list = [
                self._participant, self._weight_kg, self._height_cm,
                self._label, row["index"], row["ref_ts"], rel_time_ms,
            ]
            for c in active:
                cell = row["cells"].get(c)
                if cell:
                    out_row += [cell[0], round(cell[1], 2)]
                    present.append(str(c))
                else:
                    out_row += ["", ""]
            out_row.append("|".join(present))
            writer.writerow(out_row)

        return output.getvalue().encode("utf-8")

    def clear(self) -> None:
        with self._lock:
            self._ch_samples = {1: [], 2: [], 3: [], 4: []}
            self._total_samples = 0
            self._recording = False
