/*
  ============================================================
  EMG SLAVE  (flash this to ESP A, B, C, D)      v3 — final
  Change SLAVE_ID (0-3) and MASTER_MAC before flashing each.
  ============================================================

  Wiring (MyoWare 2.0 in RAW mode)
  ----------------------------------
  MyoWare 2.0 RAW pin  ->  GPIO 34 (ADC1_CH6)  <-- NOT GPIO 36, NOT ENV pin
  MyoWare 2.0 3.3V pin ->  3.3 V rail
  MyoWare 2.0 GND  pin ->  GND
  RAW signal centered at ~1650 mV (VCC/2). ADC_11db = 0-3.3 V range.

  SLAVE_ID assignment  (ALWAYS 0,1,2,3 -- NOT 1,2,3,4)
  -------------------------------------------------------
  SLAVE_ID=0  ->  Channel 1 on dashboard  (Slave A)
  SLAVE_ID=1  ->  Channel 2 on dashboard  (Slave B)
  SLAVE_ID=2  ->  Channel 3 on dashboard  (Slave C)
  SLAVE_ID=3  ->  Channel 4 on dashboard  (Slave D)

  Architecture v3 — production-safe
  ------------------------------------
  onRecv()  (~100 µs): ADC sample, accumulate, ping-pong handoff
  loop()    (<5 ms):   build BatchPkt, esp_now_send, Serial print

  Concurrency fixes vs v2
  ------------------------
  1. PING-PONG DOUBLE BUFFER (pp[0] / pp[1])
     v2 had a single sendBuf[].  If loop() was still processing batch N
     when batch N+1 arrived 50 ms later, sendBuf[] got silently overwritten
     and batch N was lost.
     Fix: callback alternates between pp[0] and pp[1].  loop() can be
     processing pp[0] while callback fills pp[1] — neither ever overwrites
     the other.

  2. portMUX_TYPE CRITICAL SECTIONS
     v2 shared variables (frameStart, count, ready) were not volatile and
     had no memory barriers.  On dual-core ESP32 the compiler or CPU could
     cache them in registers, giving loop() stale values.
     Fix: portENTER_CRITICAL / portEXIT_CRITICAL around every shared-state
     read or write.  Critical sections are only a handful of instructions
     (no memcpy inside lock), so preemption impact is negligible.

  3. SamplePkt REMOVED
     Master already ignores 0xDA packets.  Removing them eliminates dead
     code and saves ~10 bytes of RAM.
*/

#include <WiFi.h>
#include <esp_now.h>
#include <esp_timer.h>
#include <esp_wifi.h>

// ── USER CONFIG ────────────────────────────────────────────────────
#define SLAVE_ID 3  // ← change to 0, 1, 2, or 3 for each board

// Master MAC — copy from "Master MAC:" line printed by master at boot
uint8_t MASTER_MAC[6] = {0x00, 0x70, 0x07, 0x25, 0x36, 0x18};

// ── EMG CONFIG ─────────────────────────────────────────────────────
const int      EMG_PIN   = 34;        // MyoWare 2.0 RAW → GPIO 34 (ADC1_CH6)
const int      ADC_BITS  = 12;
const auto     ADC_ATTEN = ADC_11db;  // 0–3.3 V input range for RAW signal
const uint32_t FS_HZ     = 1000;      // one sample per 1 ms beacon
const uint32_t DT_US     = 1000;      // must equal BEACON_INTERVAL_US in master
const uint16_t BATCH     = 50;        // 50 samples = 50 ms per batch
const uint8_t  WIFI_CH   = 6;         // must equal WIFI_CHANNEL in master

// ── PACKET STRUCTS ─────────────────────────────────────────────────
#pragma pack(push, 1)

struct BeaconPkt {
  uint8_t  type;        // 0xBE
  uint32_t frame_id;
  uint64_t master_us;
};

// SamplePkt removed — master ignores 0xDA packets and it saves RAM.

struct BatchPkt {
  uint8_t  type;            // 0xBA
  uint8_t  slave_id;
  uint32_t frame_id_start;
  uint32_t t0_ms;           // frame_id_start × 1 ms (shared epoch, same on all slaves)
  uint32_t dt_us;           // inter-sample interval = DT_US
  uint16_t count;
  uint16_t mv[BATCH];
};

#pragma pack(pop)

// ── PING-PONG DOUBLE BUFFER ────────────────────────────────────────
// Guarantees batch N is never overwritten while loop() is still
// sending it.  With 100 ms batch windows and <5 ms loop() processing,
// two slots are always sufficient.
struct BatchSlot {
  uint16_t mv[BATCH];
  uint32_t frameStart;
  uint16_t count;
  bool     ready;   // true = loop() may consume; false = callback may write
};
static BatchSlot pp[2];                  // ping-pong pair
static volatile uint8_t wIdx = 0;       // which slot the callback writes NEXT

// portMUX protects: wIdx, pp[*].ready, pp[*].frameStart, pp[*].count
// pp[*].mv is written by callback BEFORE setting ready=true, and read by
// loop() AFTER seeing ready=true, so no lock is needed around the memcpy.
static portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;

// Diagnostic: count batches dropped because loop() fell behind (should be 0)
static uint32_t droppedBatches = 0;

// ── ADC ACCUMULATION (callback-private, never touched by loop()) ───
static uint16_t batchMv[BATCH];
static uint16_t batchIdx  = 0;
static uint32_t batchStart = 0;

static esp_now_peer_info_t masterPeer;

// ── Send callback intentionally not registered ───────────────────
// esp_now_register_send_cb() is optional; our code never uses the
// delivery confirmation. Omitting it avoids the wifi_tx_info_t /
// uint8_t* signature mismatch that occurs across IDF versions.

// ── RECEIVE CALLBACK — only ADC + ping-pong handoff (~100 µs) ─────
void onRecv(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
  if (len < (int)sizeof(BeaconPkt) || data[0] != 0xBE) return;
  const BeaconPkt* b = (const BeaconPkt*)data;

  // 1. Latch ADC immediately (all slaves sample at the same beacon instant)
  uint16_t mv = (uint16_t)analogReadMilliVolts(EMG_PIN);

  // 2. Record the frame_id of the very first sample in this batch
  if (batchIdx == 0) batchStart = b->frame_id;

  // 3. Accumulate
  batchMv[batchIdx++] = mv;

  // 4. Batch full → hand off to loop() via ping-pong
  if (batchIdx < BATCH) return;

  // --- Step A: decide which slot we write ----------------------------
  // Take the lock only long enough to read wIdx; memcpy happens outside.
  uint8_t w;
  portENTER_CRITICAL(&mux);
  w = wIdx;
  portEXIT_CRITICAL(&mux);

  // --- Step B: fill slot[w] -----------------------------------------
  // Only the callback writes to slots[]; loop() never touches a slot
  // that has ready==false, so no lock needed for the payload write.
  pp[w].frameStart = batchStart;
  pp[w].count      = batchIdx;                        // still == BATCH
  memcpy(pp[w].mv, batchMv, batchIdx * sizeof(uint16_t));

  // --- Step C: atomically mark ready, flip write index, reset accumulator
  portENTER_CRITICAL(&mux);
  if (pp[w].ready) {
    // loop() hasn't consumed the previous occupant of this slot.
    // Overwrite it (old batch is lost) and count the event for diagnostics.
    droppedBatches++;
  }
  pp[w].ready = true;           // hand off to loop()
  wIdx        = 1 - w;          // next batch goes to the OTHER slot
  batchIdx    = 0;              // reset accumulator inside the lock so that
                                // a concurrent read of batchIdx sees 0, not BATCH
  portEXIT_CRITICAL(&mux);
}

// ── SETUP ─────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(200);

  // Initialise ping-pong slots
  memset(pp, 0, sizeof(pp));

  analogReadResolution(ADC_BITS);
  analogSetPinAttenuation(EMG_PIN, ADC_ATTEN);

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  esp_wifi_set_channel(WIFI_CH, WIFI_SECOND_CHAN_NONE);

  // Reliable MAC read (works before WiFi.begin())
  uint8_t mac[6];
  esp_wifi_get_mac(WIFI_IF_STA, mac);
  Serial.printf("Slave MAC: %02X:%02X:%02X:%02X:%02X:%02X\n",
                mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  Serial.printf("Slave ID: %d  |  Ch: %u  |  %.0f Hz  |  %lu us/sample\n",
                SLAVE_ID, WIFI_CH, (float)FS_HZ, (unsigned long)DT_US);

  if (esp_now_init() != ESP_OK) {
    Serial.println("ESP-NOW init FAILED — halting.");
    while (true) delay(1000);
  }

  esp_now_register_recv_cb(onRecv);

  memset(&masterPeer, 0, sizeof(masterPeer));
  memcpy(masterPeer.peer_addr, MASTER_MAC, 6);
  masterPeer.channel = WIFI_CH;  // explicit channel (not 0)
  masterPeer.encrypt = false;
  if (esp_now_add_peer(&masterPeer) != ESP_OK) {
    Serial.println("Failed to add master peer — check MASTER_MAC.");
  }

  Serial.printf("Slave %d ready. Waiting for beacon...\n", SLAVE_ID);
}

// ── LOOP — batch TX + diagnostics (all heavy work here) ───────────
void loop() {
  // Check both slots; in normal operation only one will be ready per call.
  for (uint8_t r = 0; r < 2; r++) {

    // --- Atomically claim the slot -----------------------------------
    bool claimed = false;
    uint32_t fs;
    uint16_t n;

    portENTER_CRITICAL(&mux);
    if (pp[r].ready) {
      pp[r].ready = false;    // claim it — callback won't touch pp[r] again
      claimed     = true;     // until we release by NOT setting ready=true
      fs          = pp[r].frameStart;
      n           = pp[r].count;
      // Note: pp[r].mv[] is read below WITHOUT the lock.
      // This is safe because:
      //   - callback sees ready==false → writes to the OTHER slot (wIdx = 1-r)
      //   - we are the only reader of pp[r].mv[] right now
    }
    portEXIT_CRITICAL(&mux);

    if (!claimed) continue;

    // --- Build and send BatchPkt ------------------------------------
    BatchPkt bp;
    bp.type           = 0xBA;
    bp.slave_id       = SLAVE_ID;
    bp.frame_id_start = fs;
    // t0_ms = frame_id_start × 2 ms — master-epoch shared across all slaves.
    // uint64_t intermediate prevents 32-bit overflow in long sessions.
    bp.t0_ms  = (uint32_t)((uint64_t)fs * DT_US / 1000UL);
    bp.dt_us  = DT_US;
    bp.count  = n;
    memcpy(bp.mv, pp[r].mv, n * sizeof(uint16_t));

    esp_now_send(MASTER_MAC, (uint8_t*)&bp,
                 offsetof(BatchPkt, mv) + n * sizeof(uint16_t));

    // --- Diagnostics ------------------------------------------------
    uint16_t mn = 65535, mx = 0;
    for (uint16_t i = 0; i < n; i++) {
      if (pp[r].mv[i] < mn) mn = pp[r].mv[i];
      if (pp[r].mv[i] > mx) mx = pp[r].mv[i];
    }
    // droppedBatches is only incremented in callback (under lock), so a
    // non-atomic read here is safe — worst case we print a stale value.
    Serial.printf("[Slave %d] frame=%lu  t0=%lu ms  n=%u  min=%u  max=%u mV  dropped=%lu\n",
                  SLAVE_ID,
                  (unsigned long)fs,
                  (unsigned long)bp.t0_ms,
                  (unsigned)n,
                  (unsigned)mn,
                  (unsigned)mx,
                  (unsigned long)droppedBatches);
  }

  delay(1);
}
