# emg_dashboard

Real-time EMG monitor with Web Serial API — no backend server required.

**Live:** https://emg-monitor.vercel.app

## Use

1. Open the live URL in Chrome or Edge (desktop)
2. Plug in ESP32 via USB
3. Click **Connect** and select the USB device

## Local dev

```bash
cd frontend && python3 -m http.server 8080
```

## Deploy

Connected to Vercel — pushes to `main` auto-deploy when GitHub is linked.

```bash
vercel deploy --prod
```
