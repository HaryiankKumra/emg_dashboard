# GymEMG-Net — Complete System Documentation

**Version:** v3 (final)  **Author:** Mohit Kumra  **Date:** June 2026

---

## Table of Contents
1. [System Overview](#1-system-overview)
2. [Hardware: What Is Connected to What](#2-hardware-what-is-connected-to-what)
3. [Electrode Placement](#3-electrode-placement)
4. [Firmware Architecture](#4-firmware-architecture)
5. [How Synchronisation Works](#5-how-synchronisation-works)
6. [Signal Pipeline](#6-signal-pipeline)
7. [CSV Output Format](#7-csv-output-format)
8. [Dataset — This Study](#8-dataset--this-study)
9. [Data Loss & Known Issues](#9-data-loss--known-issues)
10. [How to Reproduce / Flash](#10-how-to-reproduce--flash)

---

## 1. System Overview

GymEMG-Net is a **wireless, battery-powered, 3-channel surface EMG system** built entirely from commodity hardware (ESP32 + MyoWare 2.0). It records muscle electrical activity during gym exercises without cables.

```
┌──────────────────────────────────────────────────────────────────────┐
│                          ARCHITECTURE                                │
│                                                                      │
│   [Slave A]          [Slave B]          [Slave C]                   │
│  MyoWare+ESP32      MyoWare+ESP32      MyoWare+ESP32                │
│  Rectus Femoris   Biceps Femoris    Gastrocnemius                   │
│  (C1 / ch1)        (C2 / ch2)        (C3 / ch3)                    │
│       │                  │                  │                        │
│       └──────────────────┴──────────────────┘                       │
│                  ESP-NOW (802.11, ch 6)                              │
│                  No router. No TCP. No WiFi AP.                      │
│                          │                                           │
│                   [Master ESP32]                                     │
│                   USB-UART 921600 baud                               │
│                          │                                           │
│                    [Host PC / Browser]                               │
│              Web Serial API → Chrome/Edge                            │
│              Live dashboard + CSV download                           │
└──────────────────────────────────────────────────────────────────────┘
```

**Key facts:**
- 3 slave ESPs (one per muscle), 1 master ESP (gateway only)
- Sample rate: **1000 Hz per channel** (1 ms beacon from master)
- Batch size: **50 samples per transmission** (50 ms windows)
- Transport: **ESP-NOW** — peer-to-peer, no internet required
- Host interface: **USB serial** at 921600 baud (not WiFi, not Bluetooth)

---

## 2. Hardware: What Is Connected to What

### Per Sensor Node (×3 identical nodes)

```
┌─────────────────────────────────────────────────────────────────┐
│                     SENSOR NODE SCHEMATIC                       │
│                                                                 │
│  Li-Po cell (3.7V / 500mAh)                                    │
│       │                                                         │
│       ├──► TP4056 charger (U1)  ◄── USB-C (charging input)    │
│       │     └── R2 = 4.2kΩ  → sets charge current to 250mA    │
│       │                                                         │
│       └──► LDO Regulator (3.3V out)                            │
│                 │  C1 = 10µF (bulk, low-freq transients)       │
│                 │  C2 = 100nF (ceramic, HF noise decoupling)   │
│                 │                                               │
│              [S1] ← SPST power switch                          │
│                 │                                               │
│                 ├──────────────────────────┐                   │
│                 │                          │                   │
│          [MyoWare 2.0]              [ESP32 DevKit]             │
│          3.3V ← from rail           3.3V ← from rail          │
│          GND  ← from rail           GND  ← from rail          │
│          RAW  ─────────────────────► GPIO 34 (ADC1_CH6)       │
│                                                                 │
│          [LED] ← R1 = 470Ω ─── 3.3V rail (power indicator)   │
└─────────────────────────────────────────────────────────────────┘
```

### MyoWare 2.0 Connector Wiring

| MyoWare 2.0 Pin | Connects To | Notes |
|---|---|---|
| `+` (3.3V) | 3.3V rail | Power for MyoWare IC |
| `–` (GND) | GND | Common ground |
| `RAW` | **GPIO 34** (ADC1_CH6) | Pre-rectification signal — full spectrum |
| `SIG` | ❌ NOT USED | Post-rectification envelope — do NOT use |
| `REF` snap | Bony landmark electrode | Common-mode rejection reference |

> **Why GPIO 34, not GPIO 36?** GPIO 34–39 are input-only on ESP32 — no internal pull-up that could bias the ADC. GPIO 36 is also input-only but is shared with the internal hall sensor on some modules. GPIO 34 is the cleanest option for single-ended ADC input.

> **Why RAW and not SIG?** SIG is the hardware-rectified envelope. It destroys frequency information. RAW preserves the full 20–500 Hz bipolar EMG signal, which is needed for any frequency-domain analysis (MDF, MNF, wavelet) and for CNN classifiers that need the raw waveform.

### ESP32 ADC Configuration

```cpp
const int EMG_PIN   = 34;         // GPIO 34 = ADC1_CH6
const int ADC_BITS  = 12;         // 12-bit = 0..4095 counts
const auto ADC_ATTEN = ADC_11db;  // 0–3.3V input range
```

`analogReadMilliVolts()` applies ESP32 factory calibration → output in mV (0–3300 mV).  
The RAW signal is centred at ~1650 mV (VCC/2) when muscle is at rest.

### Component BOM (per node)

| Component | Part | Value / Part No. | Function |
|---|---|---|---|
| sEMG front-end | MyoWare 2.0 | Advancer Technologies | Differential amp + bandpass filter |
| Microcontroller | ESP32 DevKit | WROOM-32 module | 12-bit ADC + ESP-NOW radio |
| Voltage regulator | LDO 3.3V | AMS1117-3.3 or similar | Clean ADC reference voltage |
| Bulk capacitor | C1 | 10µF electrolytic | Low-freq transient suppression |
| Bypass capacitor | C2 | 100nF ceramic | HF noise decoupling at ADC |
| Battery | Li-Po | 3.7V / 500mAh | Galvanic isolation from mains |
| Charger | TP4056 module | R2 = 4.2kΩ | CC/CV Li-Po charging via USB-C |
| Power switch | S1 | SPST toggle | Cuts power to ESP32 + MyoWare |
| Power LED | 3mm green | R1 = 470Ω | Visual power-on indicator |
| Electrodes | Ag/AgCl snap | Disposable | Skin-sensor interface |

**Total BOM cost per node: ~$8–10 USD**  
**3-node system + master: ~$35–40 USD total**

---

## 3. Electrode Placement

All placements follow **SENIAM (Surface Electromyography for the Non-Invasive Assessment of Muscles)** guidelines.

### Channel Assignments (this study — 3 channels)

| Channel | Slave ID | Muscle | Abbreviation | Location |
|---|---|---|---|---|
| **C1** | Slave 0 | Rectus Femoris | RF | Anterior thigh |
| **C2** | Slave 1 | Biceps Femoris | BF | Posterior thigh |
| **C3** | Slave 2 | Gastrocnemius (Medial) | GAS | Posterior calf |

### Placement Protocol (per SENIAM)

#### C1 — Rectus Femoris (Anterior Thigh)
- **Position:** 50% of the line from the anterior superior iliac spine (ASIS) to the superior part of the patella
- **Electrode orientation:** Along the muscle fibre direction (vertical, parallel to thigh long axis)
- **Inter-electrode distance:** 20 mm (between the two differential recording pads)
- **Reference electrode:** Lateral femoral condyle (bony prominence on lateral knee)
- **Skin prep:** Shave if needed, clean with isopropyl alcohol, let dry 30s

#### C2 — Biceps Femoris (Posterior Thigh)
- **Position:** 50% of the line between the ischial tuberosity (sit bone) and lateral epicondyle of the tibia
- **Electrode orientation:** Along muscle fibre direction (vertical)
- **Inter-electrode distance:** 20 mm
- **Reference electrode:** Lateral femoral condyle or fibula head
- **Note:** Participant should lie prone or stand; avoid sitting which compresses the muscle belly

#### C3 — Gastrocnemius Medialis (Posterior Calf)
- **Position:** Most prominent bulge of the medial gastrocnemius, approximately 1/3 of the distance from the popliteal crease to the heel
- **Electrode orientation:** Vertical (along muscle fibres, which run at ~10° from vertical)
- **Inter-electrode distance:** 20 mm
- **Reference electrode:** Lateral malleolus (ankle bone on outer side)

### MyoWare 2.0 Electrode Snap Layout

```
MyoWare board (viewed from electrode side):
┌────────────────────────┐
│  ⦿ E1 (recording -)   │  ← differential recording snap
│                        │
│  ⦿ E2 (recording +)   │  ← differential recording snap
│  [20mm apart on belly] │
│                        │
│  ⦿ REF                 │  ← reference snap over bony landmark
└────────────────────────┘
Place so that E1–E2 axis aligns WITH the muscle fibre direction.
```

### Mounting
- Each node is secured with an elastic velcro strap around the limb segment
- The MyoWare board (with snapped-on electrodes) sits directly on the skin
- No gel required — dry Ag/AgCl snaps have adequate contact impedance for the MyoWare front-end
- Replace electrodes between participants

---

## 4. Firmware Architecture

### Master ESP32 (`ESP_master.ino`)

```
BOOT
 │
 ├─ Serial.begin(921600)
 ├─ WiFi.mode(WIFI_STA), channel = 6
 ├─ esp_now_init() + register broadcast peer (FF:FF:FF:FF:FF:FF)
 └─ Start beacon timer (1ms periodic)

LOOP (runs ~1000x per second)
 │
 ├─ [BEACON] If beaconPending > 0:
 │    Send BeaconPkt {type=0xBE, frame_id++, master_us} to broadcast
 │    All 3 slaves receive this and sample ADC immediately
 │
 └─ [JSON DRAIN] If JSON ring buffer has data:
      Print one JSON line per loop() iteration to USB serial

RECV CALLBACK (fires when slave sends BatchPkt 0xBA)
 ├─ Parse BatchPkt: slave_id, frame_id_start, t0_ms, dt_us, mv[50]
 ├─ Build JSON: {"slave":N,"frame_id_start":M,"t0":M,"dt_us":1000,"mv":[...50 values...]}
 └─ Enqueue into ring buffer (5 slots)
```

**JSON output format (one line per batch per channel):**
```json
{"slave":0,"frame_id_start":1200,"t0":1200,"dt_us":1000,"mv":[1511,1507,1489,...50 values...]}
```

| Field | Meaning |
|---|---|
| `slave` | Slave ID: 0=RF, 1=BF, 2=GAS |
| `frame_id_start` | Master beacon counter at first sample of batch |
| `t0` | = `frame_id_start` in ms (shared epoch across ALL slaves) |
| `dt_us` | Inter-sample interval = 1000 µs |
| `mv` | Array of 50 raw ADC mV values (0–3300 mV) |

### Slave ESP32 (`ESP_slave.ino`)

```
RECV CALLBACK (fires every 1ms on beacon receipt)
 ├─ Sample GPIO 34: mv = analogReadMilliVolts(34)
 ├─ Accumulate in batchMv[] array
 └─ When 50 samples collected:
      Hand off to loop() via ping-pong double buffer

LOOP (runs continuously)
 └─ If batch ready:
      Build BatchPkt:
        frame_id_start = beacon frame_id of first sample
        t0_ms = frame_id_start × 1ms  ← SHARED EPOCH, same on all slaves
        dt_us = 1000
        mv[50] = ADC samples
      esp_now_send(MASTER_MAC, &bp, ...)
```

**Slave ID → Channel mapping:**

| `SLAVE_ID` in firmware | Channel on dashboard | Muscle |
|---|---|---|
| `0` | CH1 | Rectus Femoris |
| `1` | CH2 | Biceps Femoris |
| `2` | CH3 | Gastrocnemius |
| `3` | CH4 | (spare / not used in this study) |

---

## 5. How Synchronisation Works

This is the most important part of the system design.

### The Problem
Three separate ESP32s each have their own internal clock (`millis()` counter). If slave A powers on 2 seconds before slave B, slave A's clock reads 2000 ms while slave B's reads 0 ms — they can never be aligned using wall-clock time.

### The Solution: Master Beacon Counter
The master broadcasts a **beacon every 1 ms**. Each beacon contains a **monotonically increasing `frame_id`** (starts at 0 at master power-on).

All slaves use the **master's frame_id** — not their own clock — as their time reference:

```
Master sends:  frame_id = 1200 → ALL slaves sample ADC simultaneously
               frame_id = 1201 → ALL slaves sample ADC simultaneously
               frame_id = 1202 → ALL slaves sample ADC simultaneously
               ...
```

Each slave records: `t0_ms = frame_id_start × 1ms`

So a sample with `frame_id = 1200` from slave A (RF) and `frame_id = 1200` from slave B (BF) are **genuinely simultaneous** — they were triggered by the same beacon pulse.

### Alignment in CSV
The timestamp of sample `i` in a batch is:
```
ts_us = frame_id_start × 1000 + i × 1000   (in microseconds)
```

This is the **join key** for alignment. Two rows from different channels with the same `ts_us` are truly simultaneous.

### Why There Are Still NaN Rows
Even with perfect synchronisation, a row may have NaN for one channel if that channel's **ESP-NOW batch packet was dropped** (see §9). The master never received that 50-sample window, so those timestamps are absent for that channel.

---

## 6. Signal Pipeline

```
MUSCLE ACTIVATION
      │
      ▼ (bipolar differential electrodes, 20mm apart)
[MyoWare 2.0 Hardware]
  ├─ Instrumentation amplifier (differential, high CMRR)
  ├─ Hardware bandpass: 20–500 Hz
  └─ RAW output pin → ~1650mV centred, ±800mV swing
      │
      ▼ GPIO 34, ADC_11db, 12-bit
[ESP32 ADC]
  analogReadMilliVolts() → 0–3300 mV
  12-bit SAR, factory calibrated, ENOB ≈ 11 bits
      │
      ▼ Accumulated 50 samples
[ESP-NOW TX → Master → USB Serial]
  JSON: mv[] values in raw mV (integer)
      │
      ▼ Browser (emg-engine.js)
[Software Filter Bank — applied in real time AND offline]
  ├─ High-pass 20 Hz (Butterworth, Q=0.707)  — removes DC + motion artefact
  ├─ Low-pass 450 Hz (Butterworth, Q=0.707)  — removes HF noise, Nyquist guard
  └─ Notch 50 Hz (Q=35)                      — removes power line interference
      │
      ▼
[Downloaded CSV]
  ch1_filtered, ch2_filtered, ch3_filtered in mV
```

**Filter parameters:**
- Type: Causal biquad IIR (real-time), zero-phase bidirectional (offline/export)
- Passband: 20–450 Hz
- Notch: 50 Hz (India power line frequency)
- Sample rate: 1000 Hz

---

## 7. CSV Output Format

### New Clean Format (from v3 export)

**File:** `emg_P001_trial2_calf_raise_hwsync_filtered.csv`

```
# participant=P001 | sex=male | age=22 | weight_kg=85 | height_cm=177
# exercise=calf_raise | actual_task=Calf Raise | trial_no=2 | label=calf_raise | hw_t0_us=660456000
datetime_local,ch1_filtered_mV,ch2_filtered_mV,ch3_filtered_mV
2026-06-18 23:01:15.456,612.12,466.77,547.63
2026-06-18 23:01:15.457,693.80,583.67,684.04
2026-06-18 23:01:15.458,353.56,317.00,369.46
...
```

**Line 1:** Participant metadata (comment line, starts with `#`)  
**Line 2:** Session metadata (comment line, starts with `#`)  
**Line 3:** Column header  
**Line 4+:** Data rows

### Column Definitions

| Column | Unit | Description |
|---|---|---|
| `datetime_local` | ISO timestamp | PC wall-clock time of sample (from browser Date.now()) |
| `ch1_filtered_mV` | mV | Rectus Femoris — bandpass filtered (20–450 Hz + 50 Hz notch) |
| `ch2_filtered_mV` | mV | Biceps Femoris — bandpass filtered |
| `ch3_filtered_mV` | mV | Gastrocnemius — bandpass filtered |

- Rows where a channel has no data show empty (`,`) — this is an ESP-NOW batch drop
- Alignment is by hardware timestamp (`frame_id × 1ms`) — exact, not nearest-neighbour
- Zero-phase offline filter applied at export (forward + backward pass)

### Reading in Python

```python
import pandas as pd

df = pd.read_csv('emg_P001_trial2_calf_raise_hwsync_filtered.csv',
                 comment='#',           # skip the 2 metadata lines
                 parse_dates=['datetime_local'])

# Access meta from comment lines:
with open('emg_P001_trial2_calf_raise_hwsync_filtered.csv') as f:
    meta1 = f.readline()   # # participant=P001 | sex=male | ...
    meta2 = f.readline()   # # exercise=calf_raise | actual_task=...
```

---

## 8. Dataset — This Study

**Participant:** P001 | Male | Age 22 | 85 kg | 177 cm

### Exercise Label Corrections

> The file names reflect the original exercise labels entered in the dashboard. The actual tasks performed were different:

| File Label | Actual Task Performed |
|---|---|
| `box_jump` | **Walking** |
| `deadlift` | **Stair Climbing** (up & down) |
| `calf_raise` | **Calf Raise** ✓ (correct) |

### Recording Summary

| File | Actual Task | Duration | ch1 (RF) | ch2 (BF) | ch3 (GAS) | 3-CH Overlap |
|---|---|---|---|---|---|---|
| trial1_box_jump | Walking | 32.3s | 81.9% | 77.9% | 75.7% | 59.9% |
| trial1_calf_raise | Calf Raise | 23.5s | 57.4% | 61.6% | 57.1% | 27.9% |
| trial1_deadlift | Stair Climbing | 17.5s | 48.3% | 49.0% | 50.6% | 9.1% ⚠️ |
| trial2_box_jump | Walking | 19.0s | 60.4% | 60.8% | 60.8% | 27.2% |
| trial2_calf_raise | Calf Raise | 24.6s | 88.4% | 92.1% | 86.8% | **81.0%** ✅ |
| trial2_deadlift | Stair Climbing | 20.1s | 49.1% | 50.1% | 49.1% | 13.2% |
| trial3_box_jump | Walking | 19.6s | 60.1% | 60.1% | 60.1% | 24.2% |
| trial3_calf_raise | Calf Raise | 18.9s | 83.0% | 84.7% | 82.7% | **67.6%** ✅ |
| trial3_deadlift | Stair Climbing | 20.3s | 61.2% | 58.9% | 58.9% | 23.5% |

---

## 9. Data Loss & Known Issues

### Root Cause: ESP-NOW Batch Drops

Loss is not from Wi-Fi/TCP — there is no Wi-Fi connection. The cause is **ESP-NOW batch drops** at the slave→master link:

Each slave sends a 50-sample batch every 50ms via ESP-NOW. If the RF link degrades (participant's body between slave and master, antenna orientation change during movement), the batch is dropped and **50 consecutive samples are lost** for that channel.

### Why Stair Climbing / Deadlift Trials Are Worst
During stair climbing, the participant's torso rotates and moves significantly, frequently placing the body between the slave ESP32 and the master. This is an antenna geometry problem.

### Impact on Analysis
- Best trial (Calf Raise T2): 81% 3-channel overlap → usable for publication with caveat
- Most trials: 25–60% overlap → use per-channel independently, not as synchronised 3-channel matrix
- Stair Climbing T1: 9.1% overlap → discard for 3-channel analysis, use per-channel only

### Fix for Future Collection
1. **Place master ESP32 on participant's belt/waist**, not external — keeps antenna proximity constant
2. **Increase ESP-NOW TX power** in firmware: `esp_wifi_set_max_tx_power(84)` (max = +20 dBm)
3. **Reduce batch size from 50→20 samples** — smaller packets = less retransmit time = fewer drops
4. **Add retry counter** in slave: if `esp_now_send()` returns failure, immediately retry once
5. **Use SD card logging** as backup: slave writes to SD, master is only the real-time path

---

## 10. How to Reproduce / Flash

### Step 1 — Flash Master

1. Open `Firmware/ESP_master/ESP_master.ino` in Arduino IDE
2. Board: **ESP32 Dev Module**, Upload Speed: 921600
3. Flash. Open Serial Monitor at **921600 baud**
4. Copy the printed line: `Master MAC: XX:XX:XX:XX:XX:XX`

### Step 2 — Flash Each Slave

1. Open `Firmware/ESP_slave/ESP_slave.ino`
2. Edit line 55: `#define SLAVE_ID 0` (change to 0, 1, 2 for each node)
3. Edit line 58: paste the master MAC you copied
4. Flash. Repeat for SLAVE_ID = 1 and 2.

### Step 3 — Wiring Each Node

```
MyoWare 2.0 RAW  → ESP32 GPIO 34
MyoWare 2.0 3.3V → 3.3V rail (from LDO)
MyoWare 2.0 GND  → GND
Li-Po (+)        → TP4056 BAT+
Li-Po (-)        → TP4056 BAT-
TP4056 OUT+      → LDO input
LDO output (3.3V)→ [S1 switch] → ESP32 3V3 + MyoWare 3.3V
R1 (470Ω) + LED  → 3.3V rail to GND (power indicator)
C1 (10µF)        → LDO output to GND
C2 (100nF)       → LDO output to GND (close to ESP32 pins)
```

### Step 4 — Place Electrodes & Run

1. Apply Ag/AgCl electrodes per §3 placement guide
2. Snap electrodes onto MyoWare board
3. Power on all 3 slave nodes (green LEDs on)
4. Connect master to PC via USB
5. Open Chrome/Edge → `https://gymemgnet.vercel.app` (or localhost)
6. Click **Connect** → select the ESP32 USB port
7. Fill in participant metadata
8. Click **Record** → perform exercise → **Stop**
9. Click **Download CSV**

---

*End of documentation. For questions about the firmware, see inline comments in `ESP_master.ino` and `ESP_slave.ino`. For signal processing details, see `emg-engine.js`.*
