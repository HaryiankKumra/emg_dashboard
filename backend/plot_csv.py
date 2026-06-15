import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
from scipy import signal

# ── Load data ──────────────────────────────────────────────────────────────
csv_path = "/Users/mohitkumra/Desktop/untitled folder/emg_raw_1781176801996.csv"
df = pd.read_csv(csv_path)

fs = 1000.0                       # sample rate Hz
time_s  = df['rel_time_ms'].values / 1000.0
raw     = df['ch1_raw'].values.astype(np.float64)

# ── Filter design ──────────────────────────────────────────────────────────
nyq = fs / 2.0

# Butterworth bandpass 20-450 Hz (order 4)
bp_sos = signal.butter(4, [20/nyq, 450/nyq], btype='bandpass', output='sos')

# IIR notch at 50 Hz, Q=35
b_n, a_n   = signal.iirnotch(50.0, 35.0, fs=fs)
notch_sos  = signal.tf2sos(b_n, a_n)

# Zero-phase offline filter (same as what the backend applies on CSV export)
filt = signal.sosfiltfilt(bp_sos, raw)
filt = signal.sosfiltfilt(notch_sos, filt)

# ── Pick a 5-second window that has real muscle activity ───────────────────
# Use rolling RMS to find the busiest part of the recording
rms_roll = pd.Series(filt).pow(2).rolling(200).mean().apply(np.sqrt).fillna(0)
peak_idx = int(rms_roll.idxmax())
s = max(0,        peak_idx - 2500)
e = min(len(raw), peak_idx + 2500)
# Ensure at least 5000 samples
if e - s < 5000:
    s, e = 1000, 6000

t_seg  = time_s[s:e]
r_seg  = raw[s:e]     # raw — DC offset preserved (~1500 mV)
f_seg  = filt[s:e]    # filtered — DC removed, centred at 0

# ── PSD for the FULL recording ─────────────────────────────────────────────
freq_r, psd_r = signal.welch(raw,  fs=fs, nperseg=2048)
freq_f, psd_f = signal.welch(filt, fs=fs, nperseg=2048)

# ── Plot ───────────────────────────────────────────────────────────────────
fig = plt.figure(figsize=(11, 9.5))
fig.patch.set_facecolor('#f9f9f9')

gs = gridspec.GridSpec(3, 1, figure=fig, hspace=0.55,
                       top=0.86, bottom=0.07, left=0.10, right=0.97)

AX_TITLE = dict(fontsize=10, fontweight='bold', loc='left', pad=6)
GRID_KW  = dict(linestyle='--', alpha=0.4, color='gray')

# ── Panel 1: Raw signal (DC preserved) ────────────────────────────────────
ax1 = fig.add_subplot(gs[0])
ax1.plot(t_seg, r_seg, color='#c0392b', linewidth=0.8, label='Raw (ADC → mV)')
ax1.set_ylabel('Amplitude (mV)', fontsize=9)
ax1.set_title('① Raw Signal  — DC offset ~1 500 mV, noise unremoved', **AX_TITLE)
ax1.legend(fontsize=8, loc='upper right')
ax1.grid(**GRID_KW)
ax1.set_xlim(t_seg[0], t_seg[-1])

# ── Panel 2: Filtered signal (DC removed, true EMG) ───────────────────────
ax2 = fig.add_subplot(gs[1])
ax2.plot(t_seg, f_seg, color='#2980b9', linewidth=0.8, label='Filtered (bandpass 20-450 Hz + 50 Hz notch)')
ax2.axhline(0, color='gray', linewidth=0.6, linestyle=':')
ax2.set_ylabel('Amplitude (mV)', fontsize=9)
ax2.set_title('② Filtered Signal — DC removed, baseline wander eliminated, 50 Hz notch applied', **AX_TITLE)
ax2.legend(fontsize=8, loc='upper right')
ax2.grid(**GRID_KW)
ax2.set_xlim(t_seg[0], t_seg[-1])
ax2.set_xlabel('Time (s)', fontsize=9)

# ── Panel 3: Power Spectral Density comparison (0–200 Hz zoom) ────────────
ax3 = fig.add_subplot(gs[2])
mask = freq_r <= 200
ax3.semilogy(freq_r[mask], psd_r[mask], color='#c0392b', linewidth=1.0,
             alpha=0.85, label='Raw PSD')
ax3.semilogy(freq_f[mask], psd_f[mask], color='#2980b9', linewidth=1.0,
             alpha=0.85, label='Filtered PSD')
# Annotate 50 Hz notch
ax3.axvline(50, color='orange', linewidth=1.2, linestyle='--', alpha=0.8)
# Annotate bandpass limits
ax3.axvline(20,  color='green', linewidth=0.9, linestyle=':', alpha=0.7)

ax3.set_xlabel('Frequency (Hz)', fontsize=9)
ax3.set_ylabel('Power (mV²/Hz)', fontsize=9)
ax3.set_title('③ Power Spectral Density — 50 Hz spike clearly eliminated by notch filter', **AX_TITLE)
ax3.legend(fontsize=8, loc='upper right')
ax3.grid(**GRID_KW)
ax3.set_xlim(0, 200)

# re-annotate 50 Hz after axes are set
y_bot, y_top = ax3.get_ylim()
ax3.text(51, y_bot * 10, '50 Hz\nnotch', fontsize=7.5, color='darkorange', va='bottom')

# ── Super-title ────────────────────────────────────────────────────────────
fig.suptitle('Single-Channel Surface EMG  —  Raw vs. Filtered Comparison\n'
             'Participant: testing  ·  Label: testing  ·  fs = 1 000 Hz',
             fontsize=11, fontweight='bold', color='#1a1a2e',
             y=0.97, va='top')

out = "/Users/mohitkumra/Desktop/untitled folder/emg-monitor/emg_plot.png"
plt.savefig(out, dpi=300, bbox_inches='tight', facecolor=fig.get_facecolor())
print(f"Saved → {out}")
