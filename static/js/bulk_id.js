(function () {
  "use strict";

  var csrf = document.querySelector('meta[name="csrf-token"]').getAttribute("content");
  var form = document.getElementById("bulkIdForm");
  var idsInput = document.getElementById("bulkIdsInput");
  var passInput = document.getElementById("bulkPassInput");
  var btn = document.getElementById("bulkBtn");
  var statusEl = document.getElementById("bulkStatus");
  var toastWrap = document.getElementById("toastWrap");

  function toast(msg, type) {
    var el = document.createElement("div");
    el.className = "toast toast-" + (type || "info");
    el.textContent = msg;
    toastWrap.appendChild(el);
    setTimeout(function () { el.remove(); }, 4500);
  }

  function showStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.className = "status " + (isError ? "status-err" : "status-ok");
    statusEl.classList.remove("hidden");
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var ids = idsInput.value.trim();
    var pass = passInput.value.trim();
    if (!ids || !pass) {
      showStatus("Kam se kam ek User ID aur Password daalein.", true);
      return;
    }
    btn.disabled = true;
    btn.textContent = "Updating...";
    fetch("/api/fresh-ids/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ ids: ids, password: pass })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) {
          toast(data.message || "IDs add ho gayi.", "ok");
          window.location.href = "/dashboard?tab=fresh";
        } else {
          showStatus(data.error || "IDs save nahi ho payi.", true);
          btn.disabled = false;
          btn.textContent = "Update";
        }
      })
      .catch(function () {
        showStatus("Network error.", true);
        btn.disabled = false;
        btn.textContent = "Update";
      });
  });
})();