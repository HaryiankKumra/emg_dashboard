/*
  ============================================================
  EMG MASTER  (1x ESP32-WROOM)                  v2 — final
  ============================================================

  What it does
  ------------
  - Broadcasts a sync beacon every 1 ms (1000 Hz) over ESP-NOW
    so all 4 slaves sample their ADC simultaneously.
  - Receives 50-sample batch packets from each slave (every 50 ms).
  - Serialises each batch into one JSON line on USB-UART at
    921600 baud.  The host reads this via the Web Serial API.

  JSON output (one line per batch per channel)
  --------------------------------------------
  {"slave":0,"frame_id_start":1200,"t0":1200,"dt_us":1000,"mv":[...50 values...]}

  t0    = frame_id_start × 1 ms  (shared master epoch, same for ALL slaves)
  dt_us = 1000 (one sample per 1 ms beacon)
  mv[]  = raw ADC millivolts from analogReadMilliVolts() on slave

  NOTE: No WiFi router, no AP, no WebSocket library needed.
  Host connects via USB Web Serial API (Chrome / Edge).

  Callback-safety fixes vs v1
  ----------------------------
  1. esp_now_send() REMOVED from timer callback.
     Timer now only increments beaconPending counter (1 instruction).  loop() does the send.
     Reason: esp_timer callbacks must be very short; esp_now_send() may
     allocate buffers and briefly block the WiFi driver.

  2. Serial.println() REMOVED from ESP-NOW receive callback.
     Callback now snprintf's the JSON into a ring-buffer slot and returns.
     loop() drains the ring buffer and prints.
     Reason: Serial at 921600 baud can stall the callback for ~3 ms on a
     300-byte line — long enough to drop an incoming batch packet.

  3. broadcastPeer.channel changed from 0 to WIFI_CHANNEL (6).

  First-boot checklist
  --------------------
  1. Flash master, open Serial at 921600 baud.
     Copy "Master MAC: XX:XX:XX:XX:XX:XX" into MASTER_MAC[] in slave.
  2. Flash each slave: SLAVE_ID = 0, 1, 2, 3.
  3. Power up all slaves. Master Serial prints JSON lines.
  4. Open dashboard in Chrome → Connect at 921600 baud.
*/

#include <esp_now.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include <esp_timer.h>

// ── Constants ─────────────────────────────────────────────────────
const uint8_t  WIFI_CHANNEL        = 6;     // must match slave WIFI_CH
const uint32_t BEACON_INTERVAL_US  = 1000;  // 1 ms → 1000 Hz
const uint16_t BATCH               = 50;
const uint32_t DT_US               = 1000;  // must match slave DT_US

// ── Packet structs (must match slave exactly) ─────────────────────
#pragma pack(push, 1)
struct BeaconPkt {
  uint8_t  type;        // 0xBE
  uint32_t frame_id;
  uint64_t master_us;
};

// SamplePkt (0xDA) — kept for struct documentation; master ignores them.
struct SamplePkt {
  uint8_t  type;
  uint8_t  slave_id;
  uint32_t frame_id;
  uint16_t mv;
};

struct BatchPkt {
  uint8_t  type;        // 0xBA
  uint8_t  slave_id;
  uint32_t frame_id_start;
  uint32_t t0_ms;
  uint32_t dt_us;
  uint16_t count;
  uint16_t mv[50];
};
#pragma pack(pop)

// ── Beacon: flag-based, send from loop() ─────────────────────────
// Timer callback only sets this flag (< 1 µs).
// loop() does the actual esp_now_send().
// Use a counter instead of bool: if the timer fires twice before loop()
// processes it, both beacons are sent with their correct frame_ids.
static volatile uint32_t beaconPending = 0;
static volatile uint32_t frameCounter  = 0;

static esp_timer_handle_t beaconTimer;
static const uint8_t broadcast[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

void beaconTimerCB(void* arg) {
  // Intentionally minimal: increment counter and return (< 1 µs).
  // loop() drains every pending count so no beacon is ever skipped.
  beaconPending++;
}

// ── JSON ring buffer: build in callback, print in loop() ──────────
// 4 slots cover all 4 slaves sending simultaneously every 100 ms.
// Each JSON line: header(~55) + 50 values × 5 chars + brackets ≈ 310 bytes.
// 420 bytes per slot gives comfortable headroom.
// JSON_SLOTS must be (max simultaneous senders + 1) to avoid the ring-buffer
// empty/full sentinel wasting a usable slot.
// 4 slaves → usable slots needed = 4 → JSON_SLOTS = 5.
#define JSON_SLOTS     5
#define JSON_MAX_BYTES 420

static char    jsonRing[JSON_SLOTS][JSON_MAX_BYTES];
static uint8_t jsonLen[JSON_SLOTS];           // actual string length per slot
static volatile uint8_t qTail = 0;           // callback writes here
static volatile uint8_t qHead = 0;           // loop() reads here
static portMUX_TYPE jsonMux = portMUX_INITIALIZER_UNLOCKED;

// Returns true if the ring buffer is full (would overwrite unread slot)
static inline bool ringFull()  { return ((qTail + 1) % JSON_SLOTS) == qHead; }
static inline bool ringEmpty() { return qTail == qHead; }

// ── ESP-NOW receive callback — JSON build only, NO Serial ─────────
void onRecv(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
  if (len < 1) return;
  if (data[0] == 0xDA) return;  // ignore single-sample packets

  if (data[0] != 0xBA || len < (int)offsetof(BatchPkt, mv)) return;
  const BatchPkt* bp = (const BatchPkt*)data;
  if (bp->slave_id >= 4 || bp->count == 0 || bp->count > BATCH) return;

  // Build JSON into a temporary local buffer (stack, ~370 bytes)
  char   tmp[JSON_MAX_BYTES];
  int    n = snprintf(tmp, sizeof(tmp),
                      "{\"slave\":%u,\"frame_id_start\":%lu,"
                      "\"t0\":%lu,\"dt_us\":%lu,\"mv\":[",
                      (unsigned)bp->slave_id,
                      (unsigned long)bp->frame_id_start,
                      (unsigned long)bp->t0_ms,
                      (unsigned long)bp->dt_us);

  for (uint16_t i = 0; i < bp->count; i++) {
    if (i) tmp[n++] = ',';
    n += snprintf(tmp + n, sizeof(tmp) - n, "%u", (unsigned)bp->mv[i]);
    if (n >= (int)sizeof(tmp) - 8) break;
  }
  tmp[n++] = ']';
  tmp[n++] = '}';
  tmp[n]   = '\0';

  // Enqueue: copy into ring buffer under portMUX
  portENTER_CRITICAL(&jsonMux);
  if (!ringFull()) {
    memcpy(jsonRing[qTail], tmp, n + 1);
    jsonLen[qTail] = (uint8_t)n;
    qTail = (qTail + 1) % JSON_SLOTS;
  }
  // If full: drop this batch (should never happen at 100 ms intervals)
  portEXIT_CRITICAL(&jsonMux);
}

// ── Setup ─────────────────────────────────────────────────────────
void setup() {
  Serial.begin(921600);
  delay(200);

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  esp_wifi_set_channel(WIFI_CHANNEL, WIFI_SECOND_CHAN_NONE);

  // Reliable MAC read (works before WiFi.begin())
  uint8_t mac[6];
  esp_wifi_get_mac(WIFI_IF_STA, mac);
  Serial.printf("Master MAC: %02X:%02X:%02X:%02X:%02X:%02X\n",
                mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  Serial.println("Copy the MAC above into MASTER_MAC[] in ESP_slave.ino!");
  Serial.printf("WiFi channel: %u\n", WIFI_CHANNEL);

  if (esp_now_init() != ESP_OK) {
    Serial.println("ESP-NOW init FAILED — halting.");
    while (true) delay(1000);
  }
  esp_now_register_recv_cb(onRecv);

  // Register broadcast peer
  static esp_now_peer_info_t broadcastPeer;
  memset(&broadcastPeer, 0, sizeof(broadcastPeer));
  memset(broadcastPeer.peer_addr, 0xFF, 6);
  broadcastPeer.channel = WIFI_CHANNEL;  // explicit channel (fixed from 0)
  broadcastPeer.encrypt = false;
  esp_now_add_peer(&broadcastPeer);

  // Beacon timer — callback only sets flag; send happens in loop()
  esp_timer_create_args_t ta = {};
  ta.callback        = beaconTimerCB;
  ta.name            = "beacon";
  ta.dispatch_method = ESP_TIMER_TASK;
  esp_timer_create(&ta, &beaconTimer);
  esp_timer_start_periodic(beaconTimer, BEACON_INTERVAL_US);

  Serial.printf("Beacon every %lu us (%.0f Hz). Master ready.\n",
                (unsigned long)BEACON_INTERVAL_US,
                1e6f / BEACON_INTERVAL_US);
  Serial.println("Connect the Web Serial dashboard at 921600 baud.");
}

// ── Loop — beacon send + JSON drain ───────────────────────────────
void loop() {

  // 1. BEACON — drain ALL pending counts so no beacon is lost if the
  //    timer fired more than once before loop() ran (e.g. during Serial TX).
  while (beaconPending > 0) {
    beaconPending--;
    BeaconPkt b;
    b.type      = 0xBE;
    b.frame_id  = frameCounter++;
    b.master_us = (uint64_t)esp_timer_get_time();
    esp_now_send(broadcast, (uint8_t*)&b, sizeof(b));
  }

  // 2. JSON DRAIN — dequeue one slot per loop() iteration and print
  // Printing one at a time (not all at once) keeps loop() responsive
  // to the next beacon flag.
  {
    bool   hasData = false;
    uint8_t slot   = 0;

    portENTER_CRITICAL(&jsonMux);
    if (!ringEmpty()) {
      hasData = true;
      slot    = qHead;
      qHead   = (qHead + 1) % JSON_SLOTS;
    }
    portEXIT_CRITICAL(&jsonMux);

    if (hasData) {
      // Serial.println() queues into UART TX FIFO and returns immediately.
      // Actual transmission is interrupt-driven — no blocking here.
      Serial.println(jsonRing[slot]);
    }
  }

  // yield() lets FreeRTOS reschedule (so the timer task can set beaconPending)
  // without a fixed sleep. Compared to delay(1) this halves worst-case
  // beacon latency and keeps loop() tighter than the 2 ms beacon window.
  yield();
}
