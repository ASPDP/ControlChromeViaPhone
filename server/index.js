const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 9090;

// ── HTTP server (serves the phone controller UI) ────────────────────
const CONTROLLER_DIR = path.join(__dirname, "..", "controller");

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

const httpServer = http.createServer((req, res) => {
  let filePath = req.url === "/" ? "/index.html" : req.url;
  // Prevent path traversal
  filePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const fullPath = path.join(CONTROLLER_DIR, filePath);

  // Ensure resolved path is within CONTROLLER_DIR
  if (!fullPath.startsWith(CONTROLLER_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

// ── WebSocket relay ─────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });

const clients = {
  browser: new Set(),
  controller: new Set(),
};

wss.on("connection", (ws) => {
  let role = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (_) {
      return;
    }

    // Registration
    if (msg.type === "register") {
      role = msg.role === "browser" ? "browser" : "controller";
      clients[role].add(ws);
      console.log(`[+] ${role} connected  (browsers: ${clients.browser.size}, controllers: ${clients.controller.size})`);
      // Tell controllers how many browsers are connected
      broadcastStatus();
      return;
    }

    // Relay: controller → all browsers
    if (role === "controller") {
      const payload = raw.toString();
      console.log(`[relay] ${msg.type} → ${clients.browser.size} browser(s)`);
      for (const browser of clients.browser) {
        if (browser.readyState === 1) {
          browser.send(payload);
        }
      }
    }
  });

  ws.on("close", () => {
    if (role) {
      clients[role].delete(ws);
      console.log(`[-] ${role} disconnected  (browsers: ${clients.browser.size}, controllers: ${clients.controller.size})`);
      broadcastStatus();
    }
  });
});

function broadcastStatus() {
  const status = JSON.stringify({
    type: "status",
    browsers: clients.browser.size,
    controllers: clients.controller.size,
  });
  for (const c of clients.controller) {
    if (c.readyState === 1) c.send(status);
  }
  for (const b of clients.browser) {
    if (b.readyState === 1) b.send(status);
  }
}

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Remote Cursor relay running on http://0.0.0.0:${PORT}`);
  console.log(`Open http://<YOUR_PC_IP>:${PORT} on your phone`);
});
