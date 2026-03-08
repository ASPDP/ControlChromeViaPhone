(() => {
  "use strict";

  // ── WebSocket ─────────────────────────────────────────────────────
  const wsUrl = `ws://${location.host}`;
  let ws = null;
  let reconnectTimer = null;

  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");
  const browserCount = document.getElementById("browser-count");

  function send(msg) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
    }
  }

  function connect() {
    if (ws) try { ws.close(); } catch (_) {}
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      statusDot.classList.add("connected");
      statusText.textContent = "Connected";
      ws.send(JSON.stringify({ type: "register", role: "controller" }));
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "status") {
          browserCount.textContent = `${msg.browsers} browser(s)`;
        }
      } catch (_) {}
    };

    ws.onclose = () => {
      statusDot.classList.remove("connected");
      statusText.textContent = "Disconnected";
      reconnectTimer = setTimeout(connect, 2000);
    };

    ws.onerror = () => {};
  }

  connect();

  // ── Mode switching ────────────────────────────────────────────────
  let mode = "trackpad"; // "trackpad" | "touch" | "scroll"
  const modeBtns = document.querySelectorAll(".mode-btn");
  modeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      mode = btn.dataset.mode;
      modeBtns.forEach((b) => b.classList.toggle("active", b === btn));
    });
  });

  // ── Touchpad logic ────────────────────────────────────────────────
  const pad = document.getElementById("pad");
  const SENSITIVITY = 1.8;
  const SCROLL_SENSITIVITY = 1.5;
  const TAP_THRESHOLD = 10; // px
  const TAP_TIME = 250; // ms
  const DOUBLE_TAP_TIME = 300; // ms

  let activeTouches = new Map(); // touchId → { startX, startY, lastX, lastY, startTime, moved }
  let indicators = new Map();
  let lastTapTime = 0;
  let tapCount = 0;

  // Pinch state
  let pinchStartDist = 0;
  let isPinching = false;

  function showIndicator(id, x, y) {
    let el = indicators.get(id);
    if (!el) {
      el = document.createElement("div");
      el.className = "touch-indicator";
      pad.appendChild(el);
      indicators.set(id, el);
    }
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.opacity = "1";
  }

  function hideIndicator(id) {
    const el = indicators.get(id);
    if (el) {
      el.style.opacity = "0";
      setTimeout(() => { el.remove(); indicators.delete(id); }, 200);
    }
  }

  function distBetween(t1, t2) {
    return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
  }

  // ── Long-press for right-click ────────────────────────────────────
  let longPressTimer = null;
  let longPressFired = false;

  function startLongPress() {
    clearLongPress();
    longPressFired = false;
    longPressTimer = setTimeout(() => {
      longPressFired = true;
      send({ type: "rightclick" });
      // Vibrate for feedback
      if (navigator.vibrate) navigator.vibrate(50);
    }, 500);
  }

  function clearLongPress() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  // ── Touch events on pad ───────────────────────────────────────────
  pad.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const padRect = pad.getBoundingClientRect();

    for (const t of e.changedTouches) {
      const relX = t.clientX - padRect.left;
      const relY = t.clientY - padRect.top;
      activeTouches.set(t.identifier, {
        startX: t.clientX,
        startY: t.clientY,
        lastX: t.clientX,
        lastY: t.clientY,
        startTime: Date.now(),
        moved: false,
      });
      showIndicator(t.identifier, relX, relY);
    }

    // Single finger: start long-press detection
    if (activeTouches.size === 1) {
      startLongPress();
    } else {
      clearLongPress();
    }

    // Two-finger: init pinch / scroll
    if (activeTouches.size === 2) {
      const touches = [...e.touches];
      if (touches.length >= 2) {
        pinchStartDist = distBetween(touches[0], touches[1]);
        isPinching = false;
      }
    }

    // In touch mode, send down event
    if (mode === "touch" && activeTouches.size === 1) {
      send({ type: "down" });
    }
  }, { passive: false });

  pad.addEventListener("touchmove", (e) => {
    e.preventDefault();
    const padRect = pad.getBoundingClientRect();

    // Two-finger gestures
    if (activeTouches.size === 2 && e.touches.length >= 2) {
      clearLongPress();
      const touches = [...e.touches];
      const currentDist = distBetween(touches[0], touches[1]);
      const distDelta = currentDist - pinchStartDist;

      // Detect if it's a pinch (distance changing significantly) or scroll
      if (Math.abs(distDelta) > 20) {
        isPinching = true;
      }

      if (isPinching && mode !== "scroll") {
        // Pinch-to-zoom
        send({ type: "pinch", delta: distDelta * 0.02 });
        pinchStartDist = currentDist;
      } else {
        // Two-finger scroll
        const t = activeTouches.get(touches[0].identifier);
        if (t) {
          const dy = (touches[0].clientY - t.lastY) * SCROLL_SENSITIVITY;
          const dx = (touches[0].clientX - t.lastX) * SCROLL_SENSITIVITY;
          send({ type: "scroll", dx: -dx, dy: -dy });
          t.lastX = touches[0].clientX;
          t.lastY = touches[0].clientY;
        }
      }

      // Update indicators
      for (const touch of touches) {
        showIndicator(touch.identifier, touch.clientX - padRect.left, touch.clientY - padRect.top);
      }
      return;
    }

    // Single finger
    for (const t of e.changedTouches) {
      const state = activeTouches.get(t.identifier);
      if (!state) continue;

      const relX = t.clientX - padRect.left;
      const relY = t.clientY - padRect.top;
      showIndicator(t.identifier, relX, relY);

      const dx = t.clientX - state.lastX;
      const dy = t.clientY - state.lastY;
      const totalDist = Math.hypot(t.clientX - state.startX, t.clientY - state.startY);

      if (totalDist > TAP_THRESHOLD) {
        state.moved = true;
        clearLongPress();
      }

      state.lastX = t.clientX;
      state.lastY = t.clientY;

      if (mode === "trackpad") {
        send({ type: "move", dx: dx * SENSITIVITY, dy: dy * SENSITIVITY });
      } else if (mode === "touch") {
        // Map phone screen position to browser viewport proportionally
        const normX = relX / padRect.width;
        const normY = relY / padRect.height;
        // Send normalized coordinates; extension maps to window size
        send({
          type: "moveTo",
          x: normX * screen.width,  // approximate; extension clamps to its viewport
          y: normY * screen.height,
        });
      } else if (mode === "scroll") {
        send({ type: "scroll", dx: -dx * SCROLL_SENSITIVITY, dy: -dy * SCROLL_SENSITIVITY });
      }
    }
  }, { passive: false });

  pad.addEventListener("touchend", (e) => {
    e.preventDefault();
    clearLongPress();

    for (const t of e.changedTouches) {
      const state = activeTouches.get(t.identifier);
      hideIndicator(t.identifier);
      activeTouches.delete(t.identifier);

      if (!state) continue;

      // In touch mode, send up
      if (mode === "touch") {
        send({ type: "up" });
        continue;
      }

      // Tap detection (trackpad mode only)
      if (mode === "trackpad" && !state.moved && !longPressFired) {
        const elapsed = Date.now() - state.startTime;
        if (elapsed < TAP_TIME) {
          const now = Date.now();
          if (now - lastTapTime < DOUBLE_TAP_TIME) {
            tapCount++;
            if (tapCount >= 2) {
              send({ type: "dblclick" });
              tapCount = 0;
              lastTapTime = 0;
              continue;
            }
          } else {
            tapCount = 1;
          }
          lastTapTime = now;
          // Delay click to wait for possible double-tap
          setTimeout(() => {
            if (tapCount === 1 && Date.now() - lastTapTime >= DOUBLE_TAP_TIME) {
              send({ type: "click" });
              tapCount = 0;
            }
          }, DOUBLE_TAP_TIME);
        }
      }
    }

    isPinching = false;
    longPressFired = false;
  }, { passive: false });

  pad.addEventListener("touchcancel", (e) => {
    for (const t of e.changedTouches) {
      hideIndicator(t.identifier);
      activeTouches.delete(t.identifier);
    }
    clearLongPress();
    isPinching = false;
    longPressFired = false;
  });

  // ── Tap-and-drag (press-move-release in trackpad mode) ────────────
  // Hold a second finger, then drag with first = drag operation
  // Already handled via down/move/up in touch mode, and for trackpad
  // we detect "tap then hold" separately:
  // (This is already naturally supported by the tap-and-hold in the pad)

  // ── Action buttons ────────────────────────────────────────────────
  document.getElementById("btn-left").addEventListener("touchstart", (e) => {
    e.preventDefault();
    send({ type: "click" });
  });

  document.getElementById("btn-right").addEventListener("touchstart", (e) => {
    e.preventDefault();
    send({ type: "rightclick" });
  });

  document.getElementById("btn-back").addEventListener("touchstart", (e) => {
    e.preventDefault();
    send({ type: "key", key: "BrowserBack", code: "BrowserBack" });
    history.back.call(null); // no-op, just sends the key
  });

  document.getElementById("btn-fwd").addEventListener("touchstart", (e) => {
    e.preventDefault();
    send({ type: "key", key: "BrowserForward", code: "BrowserForward" });
  });

  // Prevent any default touch behavior on the entire body
  document.body.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
})();
