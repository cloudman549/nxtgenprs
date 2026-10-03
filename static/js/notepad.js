(function () {
  "use strict";

  var csrf = document.querySelector('meta[name="csrf-token"]').getAttribute("content");
  var area = document.getElementById("notepadContent");
  var statusEl = document.getElementById("notepadStatus");
  var saveBtn = document.getElementById("notepadSaveBtn");
  var clearBtn = document.getElementById("notepadClearBtn");
  var toastWrap = document.getElementById("toastWrap");

  var saveTimer = null;
  var isLoggedIn = false;

  function getDeviceId() {
    var k = "nxt_device_id";
    var id = null;
    try { id = localStorage.getItem(k); } catch (e) {}
    if (!id) {
      id = "dev-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem(k, id); } catch (e) {}
    }
    return id;
  }

  function toast(msg, type) {
    var el = document.createElement("div");
    el.className = "toast toast-" + (type || "info");
    el.textContent = msg;
    toastWrap.appendChild(el);
    setTimeout(function () { el.remove(); }, 3000);
  }

  function setStatus(msg) {
    if (!statusEl) return;
    statusEl.textContent = msg;
  }

  function saveNow() {
    clearTimeout(saveTimer);
    setStatus("Saving...");
    var body = { content: area.value };
    if (!isLoggedIn) body.device = getDeviceId();
    return fetch("/api/notepad", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify(body)
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) {
          var d = new Date();
          var t = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
          setStatus("Saved " + t);
        } else {
          setStatus(data.error || "Save nahi hua.");
        }
      })
      .catch(function () { setStatus("Network error."); });
  }

  area.addEventListener("input", function () {
    clearTimeout(saveTimer);
    setStatus("Typing...");
    saveTimer = setTimeout(saveNow, 900);
  });

  if (saveBtn) saveBtn.addEventListener("click", saveNow);

  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      if (!confirm("Poora notepad clear karna hai? (save bhi ho jayega)")) return;
      area.value = "";
      saveNow();
    });
  }

  fetch("/api/notepad", { headers: { "X-CSRF-Token": csrf } })
    .then(function (r) {
      if (r.status === 401) return { success: false, login_required: true };
      return r.json();
    })
    .then(function (data) {
      if (data && data.success) {
        isLoggedIn = true;
        area.value = data.content || "";
        setStatus("Loaded");
      } else if (data && data.login_required) {
        setStatus("Diary dekhne ke liye login karo (likhna bina login bhi chalta hai).");
      } else {
        setStatus("Load nahi hua.");
      }
    })
    .catch(function () { setStatus("Network error."); });
})();