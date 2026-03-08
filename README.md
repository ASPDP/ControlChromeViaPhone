# ControlChromeViaPhone

Control your Chrome browser with a **pseudo cursor** from your Android phone — like Samsung DeX's mobile trackpad, but for any browser tab.

The pseudo cursor is drawn **inside** the web page as an overlay. It dispatches real DOM events (mouse, pointer, touch, wheel) directly into the page — **no system cursor needed**. This means it works even on inactive/background browser windows.

Perfect for controlling maps (Google Maps, 2GIS, Yandex Maps), dragging, scrolling, and clicking from your phone.

## Architecture

```
┌─────────────────────┐         WebSocket         ┌──────────────────────┐
│  Android Phone      │ ──────────────────────────▶│  Relay Server        │
│  (browser touchpad) │◀──────────────────────────│  (Node.js :9090)     │
└─────────────────────┘     touch commands         └──────────┬───────────┘
                                                              │ WebSocket
                                                              ▼
                                                   ┌──────────────────────┐
                                                   │  Chrome Extension    │
                                                   │  (content script)    │
                                                   │  • pseudo cursor     │
                                                   │  • event injection   │
                                                   └──────────────────────┘
```

## Quick Start

### 1. Install the relay server

```bash
cd server
npm install
npm start
# → Running on http://0.0.0.0:9090
```

### 2. Load the Chrome extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder
4. The extension icon appears in your toolbar

### 3. Open the controller on your phone

On your Android phone's browser, navigate to:

```
http://<YOUR_PC_IP>:9090
```

(Your PC and phone must be on the same network)

That's it! You should see the pseudo cursor appear on your Chrome tabs.

## Phone Controller Modes

| Mode | Behavior |
|------|----------|
| **Trackpad** | Finger movement = relative cursor movement (like a laptop trackpad) |
| **Touch** | Finger position maps directly to screen position (like a touchscreen) |
| **Scroll** | Single-finger drag = scroll the page |

### Gestures

- **Tap** → left click
- **Double tap** → double click
- **Long press** (0.5s) → right click
- **Two-finger scroll** → scroll the page (in trackpad mode)
- **Pinch** → zoom in/out (sends Ctrl+wheel, works on maps)
- **Left Click / Right Click buttons** → bottom bar shortcuts
- **◀ / ▶ buttons** → browser back/forward

## How It Works

The Chrome extension's content script:

1. Creates a **fixed-position SVG cursor** overlay on every page (z-index max)
2. Listens for commands via WebSocket from the relay server
3. On each command, finds the element under the pseudo cursor using `elementFromPoint()`
4. Dispatches **real DOM events** (MouseEvent, PointerEvent, TouchEvent, WheelEvent) on that element
5. The page reacts exactly as if a real mouse/finger interacted with it

Because events are dispatched via JavaScript into the DOM, the **system cursor and window focus are irrelevant** — the browser window can be in the background.

## Configuration

Click the extension icon to open settings:

- **Server URL**: WebSocket URL of the relay server (default: `ws://localhost:9090`)
- **Enabled**: Toggle the pseudo cursor on/off

## Project Structure

```
extension/          Chrome extension (Manifest V3)
  ├── manifest.json
  ├── content.js    Pseudo cursor + event injection
  ├── cursor.css    Cursor styling
  ├── popup.html    Settings popup
  └── popup.js      Settings logic

server/             WebSocket relay server
  ├── package.json
  └── index.js      HTTP + WebSocket server

controller/         Phone touchpad UI (served by relay server)
  ├── index.html
  ├── style.css
  └── controller.js Touch → command translation
```

## Requirements

- **PC**: Chrome/Chromium, Node.js 16+
- **Phone**: Any modern mobile browser (Chrome, Firefox, Samsung Internet)
- **Network**: Both devices on the same local network
