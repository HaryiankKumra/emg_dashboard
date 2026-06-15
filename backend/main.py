"""
main.py
-------
FastAPI application entry point.
Provides:
  - REST API  (/api/*)
  - WebSocket (/ws)
  - Static file serving for the frontend
"""

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from data_manager import DataManager
from recorder import Recorder
from serial_manager import SerialManager

# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Shared application state
# ---------------------------------------------------------------------------
data_manager = DataManager()
recorder = Recorder()
serial_manager: Optional[SerialManager] = None


def _packet_handler(packet: dict) -> None:
    """Called by SerialManager for every successfully parsed packet."""
    data_manager.on_packet(packet)

    # Feed recorder with the full packet so it can sync channels by timestamp
    if recorder.is_recording:
        recorder.record_packet(packet)


# WebSocket connection registry
_ws_clients: set[WebSocket] = set()

# ---------------------------------------------------------------------------
# Lifespan (startup / shutdown)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start the background WebSocket broadcast task."""
    task = asyncio.create_task(_broadcast_loop())
    logger.info("EMG Monitor backend started.")
    yield
    task.cancel()
    logger.info("EMG Monitor backend stopped.")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(
    title="EMG Monitor API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# WebSocket broadcast loop (30 FPS)
# ---------------------------------------------------------------------------

async def _broadcast_loop() -> None:
    """
    Continuously broadcasts channel snapshots to all connected WebSocket clients
    at ~30 FPS (≈33 ms interval).
    """
    interval = 1 / 30
    while True:
        await asyncio.sleep(interval)
        if not _ws_clients:
            continue

        connected = serial_manager is not None and (serial_manager.connected if serial_manager else False)
        stats = serial_manager.get_stats() if serial_manager else {
            "rx_packets": 0,
            "rx_errors": 0,
            "bytes_received": 0,
        }

        payload = {
            "type": "channels",
            "connected": connected,
            "recording": recorder.is_recording,
            "recording_label": recorder.label,
            "filter_enabled": data_manager.filter_enabled,
            "stats": stats,
            "channels": data_manager.get_snapshot(),
        }

        message = json.dumps(payload)
        dead: set[WebSocket] = set()
        for ws in _ws_clients:
            try:
                await ws.send_text(message)
            except Exception:  # noqa: BLE001
                dead.add(ws)

        _ws_clients.difference_update(dead)


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    _ws_clients.add(websocket)
    logger.info("WebSocket client connected. Total: %d", len(_ws_clients))
    try:
        while True:
            # Keep connection alive; client messages are ignored.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _ws_clients.discard(websocket)
        logger.info("WebSocket client disconnected. Total: %d", len(_ws_clients))


# ---------------------------------------------------------------------------
# REST API — Pydantic models
# ---------------------------------------------------------------------------

class ConnectRequest(BaseModel):
    port: str
    baud: int = 115200


class FilterRequest(BaseModel):
    enabled: bool


class StartRequest(BaseModel):
    exercise_label: str   = "testing"
    participant:    str   = "testing"
    weight_kg:      float = 70.0
    height_cm:      float = 170.0


# ---------------------------------------------------------------------------
# REST API — endpoints
# ---------------------------------------------------------------------------

@app.get("/api/ports")
async def get_ports():
    """List available serial ports."""
    ports = SerialManager.list_ports()
    return {"ports": ports}


@app.get("/api/status")
async def get_status():
    """Return current system status."""
    connected = serial_manager is not None and serial_manager.connected
    stats = serial_manager.get_stats() if serial_manager else {
        "rx_packets": 0,
        "rx_errors": 0,
        "bytes_received": 0,
    }
    return {
        "connected": connected,
        "port": serial_manager.port if serial_manager else None,
        "recording": recorder.is_recording,
        **stats,
    }


@app.post("/api/connect")
async def connect_serial(req: ConnectRequest):
    """Open the serial port and begin reading."""
    global serial_manager
    try:
        if serial_manager and serial_manager.connected:
            serial_manager.disconnect()

        serial_manager = SerialManager(on_packet=_packet_handler)
        serial_manager.connect(req.port, req.baud)
        return {"success": True, "message": f"Connected to {req.port} @ {req.baud}"}
    except Exception as exc:
        logger.error("Connect error: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/disconnect")
async def disconnect_serial():
    """Close the serial port."""
    global serial_manager
    if serial_manager:
        serial_manager.disconnect()
    return {"success": True, "message": "Disconnected."}


@app.post("/api/start")
async def start_recording(req: StartRequest = StartRequest()):
    """Begin recording samples with session metadata."""
    data_manager.reset_filters()   # fresh filter state for the new session
    recorder.start(
        label       = req.exercise_label,
        participant = req.participant,
        weight_kg   = req.weight_kg,
        height_cm   = req.height_cm,
    )
    return {
        "success":     True,
        "message":     "Recording started.",
        "label":       req.exercise_label,
        "participant": req.participant,
    }


@app.post("/api/stop")
async def stop_recording():
    """Stop recording samples."""
    recorder.stop()
    return {
        "success": True,
        "message": "Recording stopped.",
        "samples": recorder.sample_count,
        "label": recorder.label,
    }


@app.get("/api/download")
async def download_csv(raw: bool = False):
    """Download recorded data as a CSV file.

    Query params:
      raw=false (default) — zero-phase filtered CSV (best for analysis)
      raw=true            — unfiltered ADC-converted values
    """
    if recorder.sample_count == 0:
        raise HTTPException(status_code=404, detail="No recorded data available.")

    csv_bytes = recorder.to_csv_bytes(apply_filter=not raw)
    filename  = "emg_recording_raw.csv" if raw else "emg_recording_filtered.csv"
    return Response(
        content=csv_bytes,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@app.get("/api/filter")
async def get_filter_status():
    """Return current noise-filter state."""
    return {"enabled": data_manager.filter_enabled}


@app.post("/api/filter")
async def set_filter(req: FilterRequest):
    """Enable or disable the real-time noise filter."""
    data_manager.filter_enabled = req.enabled
    if req.enabled:
        data_manager.reset_filters()   # reset zi on re-enable
    state = "enabled" if req.enabled else "disabled"
    logger.info("Noise filter %s via API", state)
    return {"enabled": req.enabled, "message": f"Filter {state}."}


# ---------------------------------------------------------------------------
# Static frontend
# ---------------------------------------------------------------------------
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_level="info",
    )
