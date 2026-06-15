/*
  ============================================================
  EMG MASTER  (1× ESP32-WROOM)
  ============================================================

  What it does
  ------------
  • Broadcasts a sync beacon every 2 ms  → all 4 slaves sample
    their MyoWare ADC simultaneously.
  • Receives batch packets from each slave (50 samples / 50 ms).
  • Reassembles them into one JSON frame per batch and forwards
    over WebSocket  (port 81) – same format as old WS firmware.
  • Also serves single-sample packets in a lightweight buffer
    so the PC can do real-time 1 kHz processing if needed.

  JSON output (per batch, one message per channel)
  -------------------------------------------------
  {"slave":0,"frame_id_start":1200,"t0":12345,"dt_us":1000,"mv":[...50 values...]}

  t0 = slave millis() at first sample in batch (NOT wall clock).
  frame_id_start = master beacon frame counter for sample sync.
  USB: each JSON line is also printed on Serial (use 921600 baud on PC).

  First-boot checklist
  --------------------
  1. Flash master, open Serial, note the line "Master MAC: XX:XX:..."
  2. Copy that MAC into MASTER_MAC[] in slave_emg.ino.
  3. Flash each slave with its SLAVE_ID (0-3).
*/

#include <esp_now.h>
#include <WiFi.h>
#include <WebSocketsServer.h>
#include <ESPmDNS.h>
#include <esp_timer.h>

// ── USER CONFIG ──────────────────────────────────────────────
const char* SSID     = "Happy";
const char* PASS     = "Happy@21";
const char* HOSTNAME = "esp32-emg-master";
// ────────────────────────────────────────────────────────────

const uint32_t BEACON_INTERVAL_US = 2000;   // 2 ms → 500 Hz beacon → 1 kHz via ADC on slave
const uint16_t BATCH               = 50;
const uint32_t DT_US               = 1000;  // matches slave FS = 1 kHz

// ── Packet structs (must match slave exactly) ─────────────────
#pragma pack(push, 1)
struct BeaconPkt {
  uint8_t  type;
  uint32_t frame_id;
  uint64_t master_us;
};

struct SamplePkt {
  uint8_t  type;
  uint8_t  slave_id;
  uint32_t frame_id;
  uint16_t mv;
};

struct BatchPkt {
  uint8_t  type;
  uint8_t  slave_id;
  uint32_t frame_id_start;
  uint32_t t0_ms;
  uint32_t dt_us;
  uint16_t count;
  uint16_t mv[50];
};
#pragma pack(pop)

// ── State ─────────────────────────────────────────────────────
static volatile uint32_t frameCounter = 0;

// Per-slave single-sample ring buffer (for real-time PC consumption)
struct SlotBuf {
  uint16_t mv[BATCH];
  uint16_t head;
  uint32_t lastFrameId;
};
static SlotBuf slots[4];

// Output buffer for JSON (one per batch TX)
static char outBuf[1700];   // slightly larger than slave: includes "slave" field

// WebSocket server
WebSocketsServer ws(81);

// ESP-NOW beacon timer
static esp_timer_handle_t beaconTimer;

// ── Core assignment ───────────────────────────────────────────
// Core 1: beacon timer + ESP-NOW RX  (WiFi stack lives here)
// Core 0: WebSocket TX               (pinned via task)
static QueueHandle_t txQueue;   // passes pointers to heap-alloc strings

// ── Beacon timer callback (Core 1) ───────────────────────────
void IRAM_ATTR beaconTimerCB(void* arg) {
  BeaconPkt b;
  b.type      = 0xBE;
  b.frame_id  = frameCounter++;
  b.master_us = (uint64_t)esp_timer_get_time();

  // Broadcast: FF:FF:FF:FF:FF:FF
  static const uint8_t broadcast[6] = {0xFF,0xFF,0xFF,0xFF,0xFF,0xFF};
  esp_now_send(broadcast, (uint8_t*)&b, sizeof(b));
}

// ── ESP-NOW receive callback (Core 1) ────────────────────────
void onRecv(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
  if (len < 1) return;

  if (data[0] == 0xDA && len == sizeof(SamplePkt)) {
    // Single sample – store in ring buffer
    const SamplePkt* sp = (const SamplePkt*)data;
    if (sp->slave_id >= 4) return;
    SlotBuf& sb = slots[sp->slave_id];
    sb.mv[sb.head % BATCH] = sp->mv;
    sb.head++;
    sb.lastFrameId = sp->frame_id;

  } else if (data[0] == 0xBA && len >= (int)offsetof(BatchPkt, mv)) {
    // Batch – build JSON and push to TX queue
    const BatchPkt* bp = (const BatchPkt*)data;
    if (bp->slave_id >= 4 || bp->count == 0 || bp->count > BATCH) return;

    // Build JSON in local buffer then heap-copy for queue
    int n = snprintf(outBuf, sizeof(outBuf),
                     "{\"slave\":%u,\"frame_id_start\":%lu,\"t0\":%lu,\"dt_us\":%lu,\"mv\":[",
                     (unsigned)bp->slave_id,
                     (unsigned long)bp->frame_id_start,
                     (unsigned long)bp->t0_ms,
                     (unsigned long)bp->dt_us);

    for (uint16_t i = 0; i < bp->count; i++) {
      if (i) outBuf[n++] = ',';
      n += snprintf(outBuf + n, sizeof(outBuf) - n, "%u", (unsigned)bp->mv[i]);
      if (n >= (int)sizeof(outBuf) - 8) break;
    }
    outBuf[n++] = ']';
    outBuf[n++] = '}';
    outBuf[n]   = '\0';

    // USB serial line for Web Serial / PC logging (one JSON object per line)
    Serial.println(outBuf);

    // Heap-alloc copy for WebSocket queue
    char* copy = (char*)malloc(n + 1);
    if (copy) {
      memcpy(copy, outBuf, n + 1);
      if (xQueueSendFromISR(txQueue, &copy, nullptr) != pdTRUE) {
        free(copy);   // queue full – drop
      }
    }

    // Serial debug
    uint16_t mn = 65535, mx = 0;
    for (uint16_t i = 0; i < bp->count; i++) {
      if (bp->mv[i] < mn) mn = bp->mv[i];
      if (bp->mv[i] > mx) mx = bp->mv[i];
    }
    Serial.printf("[Master] slave=%u t0=%lu ms n=%u min=%u mV max=%u mV\n",
                  (unsigned)bp->slave_id,
                  (unsigned long)bp->t0_ms,
                  (unsigned)bp->count,
                  (unsigned)mn, (unsigned)mx);
  }
}

// ── WebSocket callback ────────────────────────────────────────
void onWsEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t len) {
  if (type == WStype_CONNECTED) {
    IPAddress ip = ws.remoteIP(num);
    Serial.print("WS client connected: "); Serial.println(ip);
  } else if (type == WStype_DISCONNECTED) {
    Serial.println("WS client disconnected");
  }
}

// ── WebSocket TX task (Core 0) ────────────────────────────────
void wsTxTask(void* pvParam) {
  char* msg;
  for (;;) {
    if (xQueueReceive(txQueue, &msg, portMAX_DELAY) == pdTRUE) {
      ws.broadcastTXT(msg, strlen(msg));
      free(msg);
    }
    ws.loop();   // keep WS stack alive on this core
  }
}

// ── Setup ─────────────────────────────────────────────────────
void setup() {
  Serial.begin(921600);
  delay(200);

  // Init slot buffers
  memset(slots, 0, sizeof(slots));

  // Queue: holds up to 16 batch-JSON pointers
  txQueue = xQueueCreate(16, sizeof(char*));

  // WiFi – need STA for WS server AND ESP-NOW on same radio
  WiFi.mode(WIFI_STA);
  WiFi.begin(SSID, PASS);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println();
  Serial.print("IP: "); Serial.println(WiFi.localIP());
  Serial.print("WiFi Channel: ");Serial.println(WiFi.channel()); 
  Serial.print("Master MAC: "); Serial.println(WiFi.macAddress());  // ← copy to slaves

  if (MDNS.begin(HOSTNAME)) {
    Serial.printf("mDNS: %s.local\n", HOSTNAME);
  }

  // WebSocket server
  ws.begin();
  ws.onEvent(onWsEvent);
  Serial.println("WebSocket :81 ready");

  // ESP-NOW
  if (esp_now_init() != ESP_OK) {
    Serial.println("ESP-NOW init failed – halting");
    while (true) delay(1000);
  }
  esp_now_register_recv_cb(onRecv);

  // Register broadcast peer (required to send to FF:FF:FF:FF:FF:FF)
  static esp_now_peer_info_t broadcastPeer;
  memset(&broadcastPeer, 0, sizeof(broadcastPeer));
  memset(broadcastPeer.peer_addr, 0xFF, 6);
  broadcastPeer.channel = 0;
  broadcastPeer.encrypt = false;
  esp_now_add_peer(&broadcastPeer);

  // Beacon timer on Core 1 using esp_timer (1 µs resolution, no jitter)
  esp_timer_create_args_t ta = {};
  ta.callback        = beaconTimerCB;
  ta.name            = "beacon";
  ta.dispatch_method = ESP_TIMER_TASK;   // runs in esp_timer task on Core 1
  esp_timer_create(&ta, &beaconTimer);
  esp_timer_start_periodic(beaconTimer, BEACON_INTERVAL_US);
  Serial.printf("Beacon firing every %lu µs\n", (unsigned long)BEACON_INTERVAL_US);

  // WS TX task pinned to Core 0 to isolate from WiFi/ESP-NOW on Core 1
  xTaskCreatePinnedToCore(wsTxTask, "wsTX", 4096, nullptr, 1, nullptr, 0);

  Serial.println("Master ready.");
}

// ── Loop (Core 1, background) ─────────────────────────────────
void loop() {
  // Beacon and ESP-NOW RX are interrupt/timer driven.
  // Nothing critical here – just keep the watchdog fed.
  delay(10);
}
