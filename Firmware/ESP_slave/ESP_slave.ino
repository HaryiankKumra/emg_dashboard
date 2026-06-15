/*
  ============================================================
  EMG SLAVE  (flash this to ESP A, B, C, D)
  Change SLAVE_ID (0-3) and MASTER_MAC before flashing each.
  ============================================================

  Wiring
  -------
  MyoWare ENV pin  ->  GPIO 36 (ADC1_CH0)
  3.3 V / GND as normal.

  Operation
  ----------
  1. Master broadcasts a 10-byte sync beacon every 2 ms.
  2. On beacon receipt all slaves latch ADC simultaneously.
  3. Each slave waits  SLAVE_ID x 400 us  then unicasts its
     sample back to master (collision-free TDMA).
  4. Every BATCH (50) samples the slave also sends a full
     batch packet so the master can forward one JSON frame
     per channel per 50 ms - identical to the old WS design.
*/
#include <esp_wifi.h>
#include <esp_now.h>
#include <WiFi.h>
#include <esp_timer.h>
#include <esp_idf_version.h>   // for ESP_IDF_VERSION_VAL

// -- USER CONFIG ----------------------------------------------------
#define SLAVE_ID   3         // 0 = A, 1 = B, 2 = C, 3 = D

// Master MAC address - read from master Serial at first boot
uint8_t MASTER_MAC[6] = { 0x00, 0x70, 0x07, 0x25, 0x36, 0x18 }; // <- replace

// -- EMG CONFIG (unchanged from WS version) -------------------------
const int      EMG_PIN   = 34;
const int      ADC_BITS  = 12;
const auto     ADC_ATTEN = ADC_11db;
const uint32_t FS_HZ     = 1000;
const uint32_t DT_US     = 1000000UL / FS_HZ;
const uint16_t BATCH     = 50;

// -- TDMA slot delay per slave (us) ---------------------------------
const uint32_t SLOT_DELAY_US = 400;   // 4 slaves x 400 us = 1.6 ms < 2 ms frame
// -------------------------------------------------------------------

#pragma pack(push, 1)
struct BeaconPkt {
  uint8_t  type;         // 0xBE = beacon
  uint32_t frame_id;
  uint64_t master_us;
};

struct SamplePkt {
  uint8_t  type;         // 0xDA = single sample
  uint8_t  slave_id;
  uint32_t frame_id;
  uint16_t mv;
};

struct BatchPkt {
  uint8_t  type;         // 0xBA = batch
  uint8_t  slave_id;
  uint32_t frame_id_start;
  uint32_t t0_ms;
  uint32_t dt_us;
  uint16_t count;
  uint16_t mv[BATCH];
};
#pragma pack(pop)

static uint16_t batchMv[BATCH];
static uint16_t batchIdx   = 0;
static uint32_t batchStart = 0;

static esp_now_peer_info_t masterPeer;

// ------------------------------------------------------------------
// Send callback
//
// ESP32 Arduino core 3.x (IDF 5.x) changed the first argument of the
// send callback from  const uint8_t*  to  const wifi_tx_info_t*.
// The #if guard below keeps compilation working on both cores.
// ------------------------------------------------------------------
#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 0, 0)
void onSend(const wifi_tx_info_t* tx_info, esp_now_send_status_t status) {
  (void)tx_info;
  (void)status;
}
#else
void onSend(const uint8_t* mac, esp_now_send_status_t status) {
  (void)mac;
  (void)status;
}
#endif

// ------------------------------------------------------------------
// Receive callback - beacon-driven ADC sampling
// ------------------------------------------------------------------
void onRecv(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
  if (len < 1) return;
  if (data[0] != 0xBE) return;
  const BeaconPkt* b = (const BeaconPkt*)data;

  // 1. Sample ADC immediately
  uint16_t mv = (uint16_t)analogReadMilliVolts(EMG_PIN);

  // 2. Accumulate into batch
  if (batchIdx == 0) batchStart = b->frame_id;
  batchMv[batchIdx++] = mv;

  // 3. TDMA wait - stagger TX to avoid collisions
  if (SLAVE_ID > 0) ets_delay_us((uint32_t)SLAVE_ID * SLOT_DELAY_US);

  // 4. Send single-sample packet
  SamplePkt sp;
  sp.type     = 0xDA;
  sp.slave_id = SLAVE_ID;
  sp.frame_id = b->frame_id;
  sp.mv       = mv;
  esp_now_send(MASTER_MAC, (uint8_t*)&sp, sizeof(sp));

  // 5. Every BATCH samples also send full batch packet
  if (batchIdx >= BATCH) {
    uint16_t count = batchIdx;
    batchIdx = 0;

    BatchPkt bp;
    bp.type           = 0xBA;
    bp.slave_id       = SLAVE_ID;
    bp.frame_id_start = batchStart;
    bp.t0_ms          = (uint32_t)(millis() - (count - 1));  // slave uptime ms, NOT wall clock
    bp.dt_us          = DT_US;
    bp.count          = count;
    memcpy(bp.mv, batchMv, count * sizeof(uint16_t));

    esp_now_send(MASTER_MAC, (uint8_t*)&bp,
                 offsetof(BatchPkt, mv) + count * sizeof(uint16_t));

    uint16_t mn = 65535, mx = 0;
    for (uint16_t i = 0; i < count; i++) {
      if (batchMv[i] < mn) mn = batchMv[i];
      if (batchMv[i] > mx) mx = batchMv[i];
    }
    Serial.printf("[Slave %d] t0=%lu ms, n=%u, min=%u mV, max=%u mV\n",
                  SLAVE_ID, (unsigned long)bp.t0_ms,
                  (unsigned)count, (unsigned)mn, (unsigned)mx);
  }
}

// ------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(200);

  analogReadResolution(ADC_BITS);
  analogSetPinAttenuation(EMG_PIN, ADC_ATTEN);

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();

  // ✅ ADD THIS LINE (VERY IMPORTANT)
  esp_wifi_set_channel(6, WIFI_SECOND_CHAN_NONE);

  Serial.print("Slave MAC: "); Serial.println(WiFi.macAddress());
  Serial.printf("Slave ID : %d\n", SLAVE_ID);

  if (esp_now_init() != ESP_OK) {
    Serial.println("ESP-NOW init failed - halting");
    while (true) delay(1000);
  }

  esp_now_register_send_cb(onSend);
  esp_now_register_recv_cb(onRecv);

  memset(&masterPeer, 0, sizeof(masterPeer));
  memcpy(masterPeer.peer_addr, MASTER_MAC, 6);
  masterPeer.channel = 0;
  masterPeer.encrypt = false;
  if (esp_now_add_peer(&masterPeer) != ESP_OK) {
    Serial.println("Failed to add master peer - check MASTER_MAC");
  }

  Serial.printf("Slave %d ready, waiting for sync beacon...\n", SLAVE_ID);
}

void loop() {
  delay(1);
}
