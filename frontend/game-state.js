'use strict';

/* ═══════════════════════════════════════════════════════
   MyoHurdle Protocol — game-state.js
   ─────────────────────────────────────────────────────
   Shared session, game states, layout parameters, and basic helpers.
   ═══════════════════════════════════════════════════════ */

// ── Hoisted vars (shared globally via window) ──────────
var ws = null;
var wsDelay = 1200;
var rafId = null;
var lastTs = null;
var calibInterval = null;
var restInterval = null;
var calibElapsed = 0;
var flexThresholdHeld = 0;
var earlyFlexHeld = 0;
var restTooEarly = false;
var flexTimer = 0;
var sessionStartTime = 0;
var particles = [];
var shake = { x: 0, y: 0, t: 0, mag: 0 };
var waveHistories = { 1: [], 2: [], 3: [], 4: [] };
var waveHistoryCombined = [];
var lastEmgMsg = null;
var WAVE_POINTS = 120;    // how many samples in the waveform

// ── EMG live state ───────────────────────────────────
var EMG = {
  rms: 0,
  channel: '?',
  live: false,
};

// ── Session config (from setup form) ─────────────────
var SESSION = {
  participantName: '',
  sex: 'male',
  age: 25,
  weight_kg: 70,
  height_cm: 170,
  exercise: 'walking',
  trial_no: 1,
  sessionId: '',
  numHurdles: 10,
  attemptTimeLimit: 5,
  threshold: 30,
  baseline: 4,
  calibrated: false,
  activeChannels: [1],   // array of active channels, e.g. [1, 2], [1, 2, 3, 4], or [0] for Auto
  combMode: 'avg',       // avg | max | min
  targetLimb: 'leg',     // leg | arm
  anatomyZoom: 1.0,      // zoom level (1.0 = regular, 1.6 = zoomed)
};

// ── Per-hurdle log ────────────────────────────────────
var HURDLE_LOG = [];

// ── Game state ────────────────────────────────────────
var GAME = {
  phase: 'setup',
  // Phases: setup | calibrating | countdown | resting | ready |
  //         approaching | at_hurdle | jumping | hit | complete | results

  currentHurdle: 0,          // 0-indexed
  totalAttemptsThisHurdle: 0,
  currentAttemptStart: 0,    // ms timestamp
  currentPeakEMG: 0,

  // Character animation
  charFrac: 0,               // 0..1 position along track
  charY: 0,                  // vertical offset px (0=ground, neg=up)
  charVy: 0,                 // vertical velocity px/s
  charAnimT: 0,              // walking animation timer

  // Approach animation
  approachStartFrac: 0,
  approachTargetFrac: 0,
  approachT: 0,
  approachDur: 1.4,          // seconds

  // Hit/Ready timers
  hitTimer: 0,
  readyTimer: 0,             // Dedicated ready state timer (1.0s countdown)
  restTimer: 0,              // Guaranteed minimum rest state timer (2.0s countdown)
  relaxTimeHeld: 0,          // Time (seconds) the muscle has been continuously relaxed
};

// ── Canvas ────────────────────────────────────────────
var canvas = document.getElementById('game-canvas');
var ctx = canvas.getContext('2d');
var W = 0, H = 0;

// Cached layout dimensions to prevent layout-thrashing DOM reads
var anatomyWidth = 220;
var anatomyHeight = 320;
var waveWidth = 0;

// ── Layout constants ──────────────────────────────────
var TRACK_Y_FRAC = 0.70;     // track Y as fraction of canvas H
var TRACK_L_FRAC = 0.06;     // track left margin fraction
var TRACK_R_FRAC = 0.94;     // track right margin fraction
var CHAR_H = 36;             // character height in px
var CHAR_W = 14;
var HURDLE_W = 12;
var MAX_HURDLE_H = 120;      // tallest hurdle height px
var MIN_HURDLE_H = 40;       // shortest hurdle height px

// ── Global configurations & maps ──────────────────────
var LIMB_EXERCISES = {
  leg: [
    { value: 'walking', label: 'Walking', selected: true },
    { value: 'stair_ascent', label: 'Stair Ascent' },
    { value: 'stair_descent', label: 'Stair Descent' },
    { value: 'calf_raises', label: 'Calf Raises' },
    { value: 'leg_curl', label: 'Leg Curl' },
    { value: 'lunges', label: 'Lunges' },
    { value: 'leg_press', label: 'Leg Press' },
    { value: 'squats', label: 'Squats' },
    { value: 'jumping', label: 'Jumping' }
  ],
  arm: [
    { value: 'bicep_curl', label: 'Bicep Curl', selected: true },
    { value: 'tricep_ext', label: 'Tricep Extension' },
    { value: 'wrist_curl', label: 'Wrist Curl' },
    { value: 'pushup', label: 'Push-up' },
    { value: 'shoulder_press', label: 'Shoulder Press' }
  ],
  weightlifting: [
    { value: 'bicep_curl', label: 'Bicep Curl', selected: true },
    { value: 'wrist_curl', label: 'Wrist Curl' },
    { value: 'reverse_wrist_curl', label: 'Reverse Wrist Curl' },
    { value: 'bench_press', label: 'Bench Press' },
    { value: 'deadlift', label: 'Deadlift' },
    { value: 'clean_jerk', label: 'Clean & Jerk' },
    { value: 'snatch', label: 'Snatch' }
  ]
};

var CH_LABELS = {
  leg: {
    1: 'CH1 — Rectus Femoris',
    2: 'CH2 — Biceps Femoris',
    3: 'CH3 — Gastrocnemius',
    4: 'CH4 — Spare'
  },
  arm: {
    1: 'CH1 — Biceps Brachii',
    2: 'CH2 — Triceps Brachii',
    3: 'CH3 — Brachioradialis',
    4: 'CH4 — Flexor Carpi'
  },
  weightlifting: {
    1: 'CH1 — Biceps Brachii',
    2: 'CH2 — Triceps Brachii',
    3: 'CH3 — Wrist Extensors',
    4: 'CH4 — Wrist Flexors'
  }
};

var ALL_OVERLAYS = [
  'setup-overlay', 'calib-overlay', 'cd-overlay',
  'flex-overlay', 'results-overlay'
];

// ── Low-level Utility Functions ───────────────────────
function $(id)            { return document.getElementById(id); }
function lerp(a, b, t)    { return a + (b - a) * t; }
function pad2(n)          { return ('0' + n).slice(-2); }
function round2(v)        { return Math.round(v * 100) / 100; }

function flashScreen(color) {
  var app = document.getElementById('app');
  if (!app) return;
  app.classList.remove('flash-green', 'flash-red');
  void app.offsetWidth; // force reflow
  app.classList.add(color === 'green' ? 'flash-green' : 'flash-red');
}
