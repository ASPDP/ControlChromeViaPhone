(() => {
  "use strict";

  // ── Configuration (synced from popup) ─────────────────────────────
  const DEFAULT_SERVER = "ws://localhost:9090";
  let serverUrl = DEFAULT_SERVER;
  let enabled = true;

  // ── State ─────────────────────────────────────────────────────────
  let ws = null;
  let cursorX = window.innerWidth / 2;
  let cursorY = window.innerHeight / 2;
  let isPressed = false;
  let scrollAccX = 0;
  let scrollAccY = 0;
  let reconnectTimer = null;
  const RECONNECT_DELAY = 2000;

  // ── Build pseudo-cursor DOM ───────────────────────────────────────
  const cursorEl = document.createElement("div");
  cursorEl.id = "remote-pseudo-cursor";
  cursorEl.innerHTML = `
    <svg class="cursor-arrow" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 2 L4 20 L9 15 L14 22 L17 20.5 L12 13.5 L19 13 Z"
            fill="rgba(30,30,30,0.9)" stroke="white" stroke-width="1.5"
            stroke-linejoin="round"/>
    </svg>
    <div class="cursor-ring"></div>
  `;
  cursorEl.style.display = "none";

  const statusEl = document.createElement("div");
  statusEl.id = "remote-pseudo-cursor-status";
  statusEl.textContent = "Remote: connecting…";

  document.documentElement.appendChild(cursorEl);
  document.documentElement.appendChild(statusEl);

  // ── Helpers ───────────────────────────────────────────────────────
  function moveCursor(x, y) {
    cursorX = Math.max(0, Math.min(window.innerWidth, x));
    cursorY = Math.max(0, Math.min(window.innerHeight, y));
    cursorEl.style.left = cursorX + "px";
    cursorEl.style.top = cursorY + "px";
  }

  function elementAtCursor() {
    // Temporarily hide cursor so elementFromPoint doesn't hit it
    cursorEl.style.display = "none";
    const el = document.elementFromPoint(cursorX, cursorY);
    cursorEl.style.display = "";
    return el || document.body;
  }

  function dispatchMouseEvent(type, target, extra = {}) {
    const rect = target.getBoundingClientRect();
    const evt = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: cursorX,
      clientY: cursorY,
      screenX: cursorX,
      screenY: cursorY,
      button: extra.button ?? 0,
      buttons: extra.buttons ?? (type === "mousedown" || type === "mousemove" ? 1 : 0),
      ...extra,
    });
    target.dispatchEvent(evt);
  }

  function dispatchPointerEvent(type, target, extra = {}) {
    const evt = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: cursorX,
      clientY: cursorY,
      screenX: cursorX,
      screenY: cursorY,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: extra.button ?? 0,
      buttons: extra.buttons ?? (type === "pointerdown" || type === "pointermove" ? 1 : 0),
      ...extra,
    });
    target.dispatchEvent(evt);
  }

  function dispatchTouchEvent(type, target) {
    const touch = new Touch({
      identifier: 1,
      target: target,
      clientX: cursorX,
      clientY: cursorY,
      screenX: cursorX,
      screenY: cursorY,
      pageX: cursorX + window.scrollX,
      pageY: cursorY + window.scrollY,
    });
    const evt = new TouchEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      touches: type === "touchend" ? [] : [touch],
      targetTouches: type === "touchend" ? [] : [touch],
      changedTouches: [touch],
    });
    target.dispatchEvent(evt);
  }

  // ── Scroll handling ───────────────────────────────────────────────
  function doScroll(dx, dy) {
    const target = elementAtCursor();
    // Dispatch wheel event (works for most map libraries)
    const wheelEvt = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: cursorX,
      clientY: cursorY,
      deltaX: dx,
      deltaY: dy,
      deltaMode: 0, // pixels
    });
    target.dispatchEvent(wheelEvt);
  }

  // ── Command handlers ──────────────────────────────────────────────
  let lastMoveTarget = null;

  const handlers = {
    // Relative move (trackpad style)
    move(data) {
      const newX = cursorX + data.dx;
      const newY = cursorY + data.dy;
      moveCursor(newX, newY);

      const target = elementAtCursor();
      if (target !== lastMoveTarget) {
        if (lastMoveTarget) {
          dispatchPointerEvent("pointerout", lastMoveTarget);
          dispatchMouseEvent("mouseout", lastMoveTarget);
          dispatchPointerEvent("pointerleave", lastMoveTarget, { bubbles: false });
          dispatchMouseEvent("mouseleave", lastMoveTarget, { bubbles: false });
        }
        dispatchPointerEvent("pointerover", target);
        dispatchMouseEvent("mouseover", target);
        dispatchPointerEvent("pointerenter", target, { bubbles: false });
        dispatchMouseEvent("mouseenter", target, { bubbles: false });
        lastMoveTarget = target;
      }

      if (isPressed) {
        dispatchPointerEvent("pointermove", target, { buttons: 1 });
        dispatchMouseEvent("mousemove", target, { buttons: 1 });
        dispatchTouchEvent("touchmove", target);
      } else {
        dispatchPointerEvent("pointermove", target);
        dispatchMouseEvent("mousemove", target);
      }
    },

    // Absolute move (direct touch mapping)
    moveTo(data) {
      moveCursor(data.x, data.y);
      const target = elementAtCursor();

      if (isPressed) {
        dispatchPointerEvent("pointermove", target, { buttons: 1 });
        dispatchMouseEvent("mousemove", target, { buttons: 1 });
        dispatchTouchEvent("touchmove", target);
      } else {
        dispatchPointerEvent("pointermove", target);
        dispatchMouseEvent("mousemove", target);
      }
    },

    down(data) {
      const btn = data.button ?? 0;
      const btns = btn === 2 ? 2 : 1;
      isPressed = true;
      cursorEl.classList.add("pressing");
      const target = elementAtCursor();
      dispatchPointerEvent("pointerdown", target, { button: btn, buttons: btns });
      dispatchMouseEvent("mousedown", target, { button: btn, buttons: btns });
      if (btn === 0) dispatchTouchEvent("touchstart", target);
    },

    up(data) {
      const btn = data.button ?? 0;
      const target = elementAtCursor();
      dispatchPointerEvent("pointerup", target, { button: btn, buttons: 0 });
      dispatchMouseEvent("mouseup", target, { button: btn, buttons: 0 });
      if (btn === 2) {
        dispatchMouseEvent("contextmenu", target, { button: 2 });
      }
      if (btn === 0) dispatchTouchEvent("touchend", target);
      isPressed = false;
      cursorEl.classList.remove("pressing");
    },

    click(_data) {
      const target = elementAtCursor();
      dispatchPointerEvent("pointerdown", target, { button: 0, buttons: 1 });
      dispatchMouseEvent("mousedown", target, { button: 0, buttons: 1 });
      dispatchPointerEvent("pointerup", target, { button: 0, buttons: 0 });
      dispatchMouseEvent("mouseup", target, { button: 0, buttons: 0 });
      dispatchMouseEvent("click", target);
    },

    dblclick(_data) {
      const target = elementAtCursor();
      dispatchMouseEvent("click", target);
      dispatchMouseEvent("click", target);
      dispatchMouseEvent("dblclick", target);
    },

    rightclick(_data) {
      const target = elementAtCursor();
      dispatchMouseEvent("mousedown", target, { button: 2, buttons: 2 });
      dispatchMouseEvent("mouseup", target, { button: 2, buttons: 0 });
      dispatchMouseEvent("contextmenu", target, { button: 2 });
    },

    scroll(data) {
      doScroll(data.dx || 0, data.dy || 0);
    },

    // Pinch zoom — dispatches wheel with ctrlKey (standard zoom gesture)
    pinch(data) {
      const target = elementAtCursor();
      const evt = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: cursorX,
        clientY: cursorY,
        deltaY: -data.delta * 2,
        deltaMode: 0,
        ctrlKey: true, // This is how browsers signal pinch-zoom
      });
      target.dispatchEvent(evt);
    },

    // Drag for map panning (dispatches as drag sequence)
    drag(data) {
      if (data.phase === "start") {
        // Move cursor to center of window when fromCenter is set
        if (data.fromCenter) {
          moveCursor(window.innerWidth / 2, window.innerHeight / 2);
        }
        const target = elementAtCursor();
        dispatchPointerEvent("pointerdown", target, { button: 0, buttons: 1 });
        dispatchMouseEvent("mousedown", target, { button: 0, buttons: 1 });
        isPressed = true;
        cursorEl.classList.add("pressing");
      } else if (data.phase === "move") {
        const newX = cursorX + data.dx;
        const newY = cursorY + data.dy;
        moveCursor(newX, newY);
        const target = elementAtCursor();
        dispatchPointerEvent("pointermove", target, { buttons: 1 });
        dispatchMouseEvent("mousemove", target, { buttons: 1 });
      } else if (data.phase === "end") {
        const target = elementAtCursor();
        dispatchPointerEvent("pointerup", target, { button: 0, buttons: 0 });
        dispatchMouseEvent("mouseup", target, { button: 0, buttons: 0 });
        isPressed = false;
        cursorEl.classList.remove("pressing");
        // Reset cursor to center for next gesture
        moveCursor(window.innerWidth / 2, window.innerHeight / 2);
      }
    },

    // Key press passthrough
    key(data) {
      const target = elementAtCursor() || document.body;
      for (const type of ["keydown", "keypress", "keyup"]) {
        target.dispatchEvent(
          new KeyboardEvent(type, {
            bubbles: true,
            cancelable: true,
            key: data.key,
            code: data.code || "",
          })
        );
      }
    },
  };

  // ── WebSocket connection ──────────────────────────────────────────
  function connect() {
    if (ws) {
      try { ws.close(); } catch (_) {}
    }

    try {
      ws = new WebSocket(serverUrl);
    } catch (e) {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      statusEl.textContent = "Remote: connected";
      statusEl.classList.add("connected");
      cursorEl.style.display = "";
      // Register as a browser client
      ws.send(JSON.stringify({ type: "register", role: "browser" }));
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (_) {
        return;
      }

      if (!enabled) return;

      const handler = handlers[msg.type];
      if (handler) {
        handler(msg);
      }
    };

    ws.onclose = () => {
      statusEl.textContent = "Remote: disconnected";
      statusEl.classList.remove("connected");
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will fire after this
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_DELAY);
  }

  // ── Settings sync ─────────────────────────────────────────────────
  function loadSettings() {
    chrome.storage.local.get(["serverUrl", "enabled"], (result) => {
      if (result.serverUrl) serverUrl = result.serverUrl;
      if (result.enabled !== undefined) enabled = result.enabled;
      connect();
    });
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.serverUrl) {
      serverUrl = changes.serverUrl.newValue || DEFAULT_SERVER;
      connect(); // reconnect with new URL
    }
    if (changes.enabled !== undefined) {
      enabled = changes.enabled.newValue;
      cursorEl.style.display = enabled ? "" : "none";
    }
  });

  // ── Initialize ────────────────────────────────────────────────────
  moveCursor(cursorX, cursorY);
  loadSettings();
})();
