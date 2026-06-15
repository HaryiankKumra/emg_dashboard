"""
serial_manager.py
-----------------
Handles all serial port communication with the ESP32 master device.
Reads JSON packets, parses them safely, and updates shared state.

Fixes applied:
  - Added 2-second DTR settle delay after open (prevents macOS [Errno 6]
    caused by the CH340/CP2102 asserting DTR which resets the ESP32).
  - Auto-reconnect: if the serial drops mid-session, the reader loop
    waits and retries opening the same port until disconnect() is called.
"""

import json
import logging
import threading
import time
from typing import Optional, Callable

import serial
import serial.tools.list_ports

logger = logging.getLogger(__name__)

# How long to wait after opening the port for the ESP32 to finish
# its bootloader reset cycle (triggered by DTR toggle on macOS).
_DTR_SETTLE_SECONDS = 2.0

# Auto-reconnect delay (seconds) between retry attempts.
_RECONNECT_DELAY = 3.0


class SerialManager:
    """
    Manages the serial connection to the ESP32 device.
    Runs a background thread that continuously reads and parses
    JSON packets from the serial port, with automatic reconnection
    on cable drop or ESP32 reset.
    """

    def __init__(self, on_packet: Callable[[dict], None]):
        """
        Args:
            on_packet: Callback invoked with each successfully parsed packet dict.
        """
        self._on_packet = on_packet
        self._serial: Optional[serial.Serial] = None
        self._thread: Optional[threading.Thread] = None
        self._running = False

        # Statistics (cumulative across reconnects)
        self.rx_packets: int = 0
        self.rx_errors: int = 0
        self.bytes_received: int = 0

        self.port: Optional[str] = None
        self.baud: int = 115200
        self.connected: bool = False

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @staticmethod
    def list_ports() -> list[dict]:
        """Return a list of available serial ports with metadata."""
        ports = []
        for p in serial.tools.list_ports.comports():
            ports.append({
                "port": p.device,
                "description": p.description or "Unknown",
                "hwid": p.hwid or "",
            })
        return ports

    def connect(self, port: str, baud: int = 115200) -> None:
        """
        Open the serial port and start the reader/reconnect thread.

        Raises:
            serial.SerialException: If the initial port open fails.
        """
        if self._running:
            self.disconnect()

        self.port = port
        self.baud = baud
        self._running = True

        # Reset statistics on fresh connection request
        self.rx_packets = 0
        self.rx_errors = 0
        self.bytes_received = 0

        # Try opening once here so the caller gets an immediate exception
        # on invalid port, wrong permissions, etc.
        self._open_port()

        self._thread = threading.Thread(
            target=self._reconnect_loop,
            name="serial-reader",
            daemon=True,
        )
        self._thread.start()
        logger.info("Serial reader thread started.")

    def disconnect(self) -> None:
        """Stop the reader thread and close the serial port."""
        logger.info("Disconnecting serial port.")
        self._running = False
        self.connected = False

        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5.0)

        self._close_port()
        self._thread = None
        logger.info("Serial disconnected.")

    def get_stats(self) -> dict:
        """Return current packet statistics."""
        return {
            "rx_packets": self.rx_packets,
            "rx_errors": self.rx_errors,
            "bytes_received": self.bytes_received,
        }

    # ------------------------------------------------------------------
    # Port open / close helpers
    # ------------------------------------------------------------------

    def _open_port(self) -> None:
        """
        Open the serial port and wait for the ESP32 DTR-reset to finish.

        On macOS, opening a CP2102/CH340 port toggles DTR which triggers
        the ESP32 bootloader reset. Without a settle delay, readline()
        races with the reset and raises [Errno 6] Device not configured.
        """
        logger.info("Opening %s @ %d baud", self.port, self.baud)
        self._serial = serial.Serial(
            port=self.port,
            baudrate=self.baud,
            timeout=1.0,
            bytesize=serial.EIGHTBITS,
            parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_ONE,
            # Keep DTR/RTS low after open to minimise reset glitches
            dsrdtr=False,
            rtscts=False,
        )
        # Explicitly de-assert DTR so the ESP32 does not reset.
        self._serial.dtr = False
        self._serial.rts = False

        logger.info(
            "Port open — waiting %.1fs for ESP32 to settle…", _DTR_SETTLE_SECONDS
        )
        # Flush any garbage in the receive buffer accumulated during reset
        time.sleep(_DTR_SETTLE_SECONDS)
        self._serial.reset_input_buffer()

        self.connected = True
        logger.info("ESP32 ready on %s", self.port)

    def _close_port(self) -> None:
        """Close the serial port silently."""
        if self._serial and self._serial.is_open:
            try:
                self._serial.close()
            except Exception as exc:  # noqa: BLE001
                logger.warning("Error closing port: %s", exc)
        self._serial = None

    # ------------------------------------------------------------------
    # Reconnect loop (runs in background thread)
    # ------------------------------------------------------------------

    def _reconnect_loop(self) -> None:
        """
        Outer loop: runs the reader, and if it exits due to a serial error,
        waits _RECONNECT_DELAY seconds then tries to reopen the port.
        Exits cleanly when _running is set to False by disconnect().
        """
        while self._running:
            try:
                self._reader_loop()
            except Exception as exc:  # noqa: BLE001
                logger.error("Reader loop crashed: %s", exc)

            if not self._running:
                break

            # Port dropped — attempt reconnect
            self.connected = False
            self._close_port()
            logger.info(
                "Serial disconnected. Retrying in %.0fs…", _RECONNECT_DELAY
            )
            time.sleep(_RECONNECT_DELAY)

            while self._running:
                try:
                    self._open_port()
                    logger.info("Reconnected to %s", self.port)
                    break
                except serial.SerialException as exc:
                    logger.warning("Reconnect failed: %s — retrying in %.0fs", exc, _RECONNECT_DELAY)
                    time.sleep(_RECONNECT_DELAY)

        logger.info("Serial reconnect loop exited.")

    # ------------------------------------------------------------------
    # Inner reader loop
    # ------------------------------------------------------------------

    def _reader_loop(self) -> None:
        """
        Read lines from the open serial port, parse JSON packets,
        and fire on_packet. Exits on SerialException (triggers reconnect).
        """
        logger.info("Reader loop running on %s", self.port)
        while self._running:
            if not self._serial or not self._serial.is_open:
                break

            try:
                # readline() blocks up to the timeout=1.0s set at open
                chunk = self._serial.readline()
            except serial.SerialException as exc:
                logger.error("Serial error in reader loop: %s", exc)
                self.connected = False
                raise   # bubble up to _reconnect_loop

            if not chunk:
                continue  # timeout — no data, loop again

            self.bytes_received += len(chunk)

            # Decode line
            try:
                line = chunk.decode("utf-8", errors="replace").strip()
            except Exception:  # noqa: BLE001
                self.rx_errors += 1
                continue

            if not line:
                continue

            # Parse JSON packet
            try:
                packet = json.loads(line)
                self.rx_packets += 1
                self._on_packet(packet)
            except json.JSONDecodeError:
                self.rx_errors += 1
                logger.debug("Non-JSON line: %s", line[:80])
            except Exception as exc:  # noqa: BLE001
                logger.error("Packet callback error: %s", exc)
                self.rx_errors += 1

        logger.info("Reader loop exited.")
