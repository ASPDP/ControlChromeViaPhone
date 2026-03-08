const serverInput = document.getElementById("server");
const enabledInput = document.getElementById("enabled");
const saveBtn = document.getElementById("save");

chrome.storage.local.get(["serverUrl", "enabled"], (result) => {
  serverInput.value = result.serverUrl || "ws://localhost:9090";
  enabledInput.checked = result.enabled !== false;
});

saveBtn.addEventListener("click", () => {
  chrome.storage.local.set({
    serverUrl: serverInput.value.trim() || "ws://localhost:9090",
    enabled: enabledInput.checked,
  });
  saveBtn.textContent = "Saved!";
  setTimeout(() => (saveBtn.textContent = "Save & Reconnect"), 1200);
});

enabledInput.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: enabledInput.checked });
});
