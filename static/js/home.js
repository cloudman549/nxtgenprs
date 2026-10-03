(function () {
  "use strict";

  var csrf = document.querySelector('meta[name="csrf-token"]').getAttribute("content");
  var maxSizeMb = parseInt(document.getElementById("maxSizeMb").value, 10) || 50;
  var isLoggedIn = document.getElementById("isLoggedIn");
  if (isLoggedIn) isLoggedIn = isLoggedIn.value === "1";
  else isLoggedIn = !!document.getElementById("pdfList");

  var dropZone = document.getElementById("dropZone");
  var fileInput = document.getElementById("fileInput");
  var pickBtn = document.getElementById("pickBtn");
  var progressWrap = document.getElementById("uploadProgress");
  var progressBar = document.getElementById("uploadProgressBar");
  var progressPct = document.getElementById("uploadProgressPct");
  var progressLabel = document.getElementById("uploadProgressLabel");
  var uploadStatus = document.getElementById("uploadStatus");
  var pdfList = document.getElementById("pdfList");
  var emptyState = document.getElementById("emptyState");
  var refreshBtn = document.getElementById("refreshBtn");
  var searchInput = document.getElementById("searchInput");
  var dateFilter = document.getElementById("dateFilter");
  var toastWrap = document.getElementById("toastWrap");

  var accessUserInput = document.getElementById("accessUserInput");
  var accessPassInput = document.getElementById("accessPassInput");
  var pendingFiles = [];
  var pendingWrap = document.getElementById("pendingWrap");
  var pendingList = document.getElementById("pendingList");
  var uploadBtn = document.getElementById("uploadBtn");

  var allPdfs = [];

  var MAX_BYTES = maxSizeMb * 1024 * 1024;

  function toast(msg, type) {
    var el = document.createElement("div");
    el.className = "toast toast-" + (type || "info");
    el.textContent = msg;
    toastWrap.appendChild(el);
    setTimeout(function () { el.remove(); }, 4500);
  }

  function showStatus(msg, isError) {
    uploadStatus.textContent = msg;
    uploadStatus.className = "status " + (isError ? "status-err" : "status-ok");
    uploadStatus.classList.remove("hidden");
  }

  function hideStatus() {
    uploadStatus.classList.add("hidden");
  }

  function setProgress(pct, label) {
    progressWrap.classList.remove("hidden");
    progressBar.style.width = pct + "%";
    progressPct.textContent = pct + "%";
    if (label) progressLabel.textContent = label;
  }

  function hideProgress() {
    progressWrap.classList.add("hidden");
    progressBar.style.width = "0%";
    progressPct.textContent = "0%";
  }

  function humanSize(n) {
    n = Number(n) || 0;
    var units = ["B", "KB", "MB", "GB"];
    for (var i = 0; i < units.length; i++) {
      if (n < 1024) return (i === 0 ? n + " B" : n.toFixed(1) + " " + units[i]);
      n /= 1024;
    }
    return n.toFixed(1) + " TB";
  }

  function formatDate(iso) {
    if (!iso) return "-";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  }

  function daysLeft(expiresIso) {
    if (!expiresIso) return "";
    var diff = new Date(expiresIso).getTime() - Date.now();
    if (isNaN(diff)) return "";
    var days = Math.ceil(diff / 86400000);
    if (days <= 0) return "  •  expires today";
    if (days === 1) return "  •  1 din baki";
    return "  •  " + days + " din baki";
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderList(items) {
    pdfList.innerHTML = "";
    if (!items.length) {
      var empty = document.createElement("div");
      empty.className = "empty";
      if (allPdfs.length && (dateFilter && dateFilter.value === "today")) {
        empty.textContent = "Aaj (today) koi PDF upload nahi hui. 'All Days' chun kar pura list dekhein.";
      } else if (allPdfs.length && searchInput && searchInput.value.trim()) {
        empty.textContent = "Search se koi PDF nahi mili.";
      } else {
        empty.textContent = "Abhi koi PDF upload nahi hua.";
      }
      pdfList.appendChild(empty);
      return;
    }
    items.forEach(function (pdf) {
      var row = document.createElement("div");
      row.className = "pdf-row";

      var main = document.createElement("div");
      main.className = "pdf-main";
      var icon = document.createElement("div");
      icon.className = "pdf-icon";
      icon.textContent = "PDF";
      var info = document.createElement("div");
      info.style.minWidth = "0";
      var name = document.createElement("div");
      name.className = "pdf-name pdf-open";
      name.textContent = pdf.filename || "document.pdf";
      name.title = "PDF kholne ke liye click karo";
      name.addEventListener("click", function () {
        window.open("/api/pdfs/" + pdf.id + "/view", "_blank");
      });
      var meta = document.createElement("div");
      meta.className = "pdf-meta";
      meta.textContent =
        (pdf.size_human || humanSize(pdf.size)) +
        "  •  " + (formatDate(pdf.uploaded_at)) +
        daysLeft(pdf.expires_at);
      info.appendChild(name);
      info.appendChild(meta);
      if (pdf.access_user || pdf.access_pass) {
        var creds = document.createElement("div");
        creds.className = "pdf-creds";
        creds.textContent = "User ID: " + (pdf.access_user || "-") + "  •  Password: " + (pdf.access_pass || "-");
        info.appendChild(creds);
      }
      main.appendChild(icon);
      main.appendChild(info);

      var actions = document.createElement("div");
      actions.className = "pdf-actions";

      var dl = document.createElement("button");
      dl.className = "btn btn-primary btn-sm";
      dl.type = "button";
      dl.textContent = "Download";
      dl.addEventListener("click", function () {
        window.location.href = "/api/pdfs/" + pdf.id + "/download";
      });

      var share = document.createElement("button");
      share.className = "btn btn-ghost btn-sm";
      share.type = "button";
      share.textContent = "Share (10 min)";
      share.addEventListener("click", function () {
        share.disabled = true;
        share.textContent = "Bana rahe hain...";
        fetch("/api/pdfs/" + pdf.id + "/share", { headers: { "X-CSRF-Token": csrf } })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.success) {
              return copyText(data.url).then(function () {
                toast("Share link copy ho gaya. WhatsApp pe bhejo — 10 min valid.", "ok");
              });
            }
            toast((data && data.error) || "Share link nahi bana.", "err");
          })
          .catch(function () { toast("Network error.", "err"); })
          .finally(function () { share.disabled = false; share.textContent = "Share (10 min)"; });
      });

      var del = document.createElement("button");
      del.className = "btn btn-danger btn-sm";
      del.type = "button";
      del.textContent = "Delete";
      del.addEventListener("click", function () {
        if (!confirm("PDF '" + (pdf.filename || "document.pdf") + "' delete karne ka confirm hai?")) return;
        del.disabled = true;
        fetch("/api/pdfs/" + pdf.id, { method: "DELETE", headers: { "X-CSRF-Token": csrf } })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.success) { toast(data.message || "PDF deleted.", "ok"); loadPdfs(); }
            else { toast(data.error || "Delete failed.", "err"); del.disabled = false; }
          })
          .catch(function () { toast("Network error.", "err"); del.disabled = false; });
      });

      actions.appendChild(dl);
      actions.appendChild(share);
      actions.appendChild(del);

      row.appendChild(main);
      row.appendChild(actions);
      pdfList.appendChild(row);
    });
  }

  function renderLoginPrompt() {
    pdfList.innerHTML = "";
    var empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "PDF list dekhne ke liye login karo.";
    var wrap = document.createElement("div");
    wrap.style.textAlign = "center";
    wrap.style.marginTop = "10px";
    var btn = document.createElement("a");
    btn.className = "btn btn-primary";
    btn.href = "/login?next=/";
    btn.textContent = "Login karein";
    wrap.appendChild(btn);
    pdfList.appendChild(empty);
    pdfList.appendChild(wrap);
  }

  function sameDay(iso, dayStart, dayEnd) {
    if (!iso) return false;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return false;
    return d >= dayStart && d < dayEnd;
  }

  function getDayBounds(offsetDays) {
    var now = new Date();
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    start.setDate(start.getDate() + offsetDays);
    var end = new Date(start.getTime() + 86400000);
    return { start: start, end: end };
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {
        return fallbackCopy(text);
      });
    }
    return Promise.resolve().then(function () { return fallbackCopy(text); });
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
    return Promise.resolve();
  }

  function renderFiltered() {
    var q = (searchInput ? searchInput.value.trim() : "").toLowerCase();
    var filter = dateFilter ? dateFilter.value : "all";
    var bounds = getDayBounds(0);

    var items = allPdfs.filter(function (pdf) {
      var name = (pdf.filename || "").toLowerCase();
      if (q && name.indexOf(q) === -1) return false;
      if (filter === "today" && !sameDay(pdf.uploaded_at, bounds.start, bounds.end)) return false;
      return true;
    });

    renderList(items);
  }

  function loadPdfs() {
    emptyState.classList.remove("hidden");
    emptyState.textContent = "Loading...";
    fetch("/api/pdfs", { headers: { "X-CSRF-Token": csrf } })
      .then(function (r) {
        if (r.status === 401 && !isLoggedIn) {
          renderLoginPrompt();
          throw new Error("login-required");
        }
        return r.json();
      })
      .then(function (data) {
        emptyState.classList.add("hidden");
        if (data.success) {
          allPdfs = data.pdfs || [];
          renderFiltered();
        }
        else { emptyState.classList.remove("hidden"); emptyState.textContent = "List load nahi ho saki."; }
      })
      .catch(function (err) {
        if (err && err.message === "login-required") return;
        emptyState.classList.remove("hidden");
        emptyState.textContent = "Network error. Refresh karein.";
      });
  }

  function uploadOne(file) {
    return new Promise(function (resolve, reject) {
      var form = new FormData();
      form.append("file", file);
      if (accessUserInput && accessUserInput.value) form.append("access_user", accessUserInput.value.trim());
      if (accessPassInput && accessPassInput.value) form.append("access_pass", accessPassInput.value);
      var xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/upload");
      xhr.setRequestHeader("X-CSRF-Token", csrf);
      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable) {
          var pct = Math.round((e.loaded / e.total) * 100);
          setProgress(pct, "Uploading: " + file.name);
        }
      };
      xhr.onload = function () {
        var data = {};
        try { data = JSON.parse(xhr.responseText); } catch (err) { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300 && data.success) resolve(data);
        else reject((data && data.error) || ("Upload failed (server code " + xhr.status + ")."));
      };
      xhr.onerror = function () { reject("Network error during upload."); };
      xhr.send(form);
    });
  }

  function handleFiles(files) {
    hideStatus();
    if (!files || !files.length) return;
    if (isLoggedIn === false) {
      toast("Upload karne ke liye login karna hoga.", "err");
      setTimeout(function () { window.location.href = "/login"; }, 1300);
      return;
    }

    Array.prototype.forEach.call(files, function (f) {
      var lower = (f.name || "").toLowerCase();
      if (!lower.endsWith(".pdf")) {
        toast('"' + f.name + '" PDF nahi hai. Sirf PDF files.', "err");
        return;
      }
      if (f.size > MAX_BYTES) {
        toast('"' + f.name + '" bahut badi hai (max ' + maxSizeMb + " MB).", "err");
        return;
      }
      if (f.size === 0) {
        toast('"' + f.name + '" khali (empty) hai.', "err");
        return;
      }
      pendingFiles.push(f);
    });

    renderPending();
  }

  function renderPending() {
    if (pendingList) pendingList.innerHTML = "";
    hideProgress();
    if (!pendingFiles.length) {
      if (pendingWrap) pendingWrap.classList.add("hidden");
      if (uploadBtn) uploadBtn.disabled = true;
      return;
    }
    if (pendingWrap) pendingWrap.classList.remove("hidden");
    if (uploadBtn) uploadBtn.disabled = false;
    pendingFiles.forEach(function (f, idx) {
      var row = document.createElement("div");
      row.className = "pending-row";
      var nm = document.createElement("div");
      nm.className = "pending-name";
      nm.textContent = f.name;
      nm.title = f.name;
      var sz = document.createElement("div");
      sz.className = "pending-size muted";
      sz.textContent = humanSize(f.size);
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "btn btn-ghost btn-sm";
      rm.textContent = "Remove";
      rm.title = "Is file ko hatayein";
      rm.addEventListener("click", function () {
        pendingFiles.splice(idx, 1);
        renderPending();
      });
      row.appendChild(nm);
      row.appendChild(sz);
      row.appendChild(rm);
      pendingList.appendChild(row);
    });
  }

  function startUpload() {
    if (!pendingFiles.length) return;
    var files = pendingFiles.slice();
    pendingFiles = [];
    if (uploadBtn) uploadBtn.disabled = true;
    hideStatus();

    var i = 0;
    function next() {
      if (i >= files.length) {
        hideProgress();
        showStatus(files.length + " file(s) successfully upload ho gayi.");
        renderPending();
        loadPdfs();
        return;
      }
      setProgress(0, "Uploading: " + files[i].name);
      uploadOne(files[i])
        .then(function () { i++; next(); })
        .catch(function (errMsg) {
          i++;
          toast(errMsg, "err");
          next();
        });
    }
    next();
  }

  // ---- Events ----
  pickBtn.addEventListener("click", function () { fileInput.click(); });
  fileInput.addEventListener("change", function () { handleFiles(fileInput.files); fileInput.value = ""; });
  if (refreshBtn) refreshBtn.addEventListener("click", loadPdfs);
  if (uploadBtn) uploadBtn.addEventListener("click", startUpload);

  if (searchInput) {
    searchInput.addEventListener("input", renderFiltered);
  }
  if (dateFilter) {
    dateFilter.addEventListener("change", renderFiltered);
  }

  dropZone.addEventListener("click", function (e) {
    if (e.target === dropZone || e.target.closest(".dropzone-inner")) fileInput.click();
  });

  ["dragenter", "dragover"].forEach(function (ev) {
    dropZone.addEventListener(ev, function (e) {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add("drag-over");
    });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    dropZone.addEventListener(ev, function (e) {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove("drag-over");
    });
  });
  dropZone.addEventListener("drop", function (e) {
    handleFiles(e.dataTransfer.files);
  });

  document.addEventListener("keydown", function (e) {
    if ((e.key === "d" || e.key === "D") && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      var target = e.target;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      fileInput.click();
    }
  });

  // ---------------- Dashboard tabs ----------------
  var dashTabs = document.querySelectorAll(".dash-tab[data-tab]");
  function showTab(name) {
    document.querySelectorAll("[data-section]").forEach(function (sec) {
      if (sec.getAttribute("data-section") === name) sec.classList.remove("hidden");
      else sec.classList.add("hidden");
    });
    dashTabs.forEach(function (t) {
      t.classList.toggle("active", t.getAttribute("data-tab") === name);
    });
    if (name === "pdfs") loadPdfs();
    if (name === "fresh") loadFreshIds();
    if (name === "order") loadOrders();
  }
  dashTabs.forEach(function (t) {
    t.addEventListener("click", function () { showTab(t.getAttribute("data-tab")); });
  });

  var initialTab = new URLSearchParams(window.location.search).get("tab");
  if (initialTab && (initialTab === "fresh" || initialTab === "pdfs" || initialTab === "order")) {
    showTab(initialTab);
  }

  // ---------------- Fresh IDs ----------------
  var freshForm = document.getElementById("freshIdForm");
  var freshList = document.getElementById("freshList");
  var refreshFreshBtn = document.getElementById("refreshFreshBtn");
  var freshIdBtn = document.getElementById("freshIdBtn");

  function renderFreshIds(items) {
    if (!freshList) return;
    freshList.innerHTML = "";
    if (!items.length) {
      var e = document.createElement("div");
      e.className = "empty";
      e.textContent = "Abhi koi Fresh ID add nahi hui.";
      freshList.appendChild(e);
      return;
    }
    items.forEach(function (f) {
      var row = document.createElement("div");
      row.className = "user-row";
      var info = document.createElement("div");
      info.className = "user-info";
      var nm = document.createElement("div");
      nm.className = "user-name";
      nm.textContent = f.user_id_value;
      var meta = document.createElement("div");
      meta.className = "muted user-email";
      meta.textContent = "Password: " + f.password + "  •  " + (f.owner || "-");
      info.appendChild(nm);
      info.appendChild(meta);
      var del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn-danger btn-sm";
      del.textContent = "Delete";
      del.addEventListener("click", function () {
        if (!confirm("ID '" + f.user_id_value + "' delete karni hai?")) return;
        fetch("/api/fresh-ids/" + f.id, { method: "DELETE", headers: { "X-CSRF-Token": csrf } })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.success) { toast("ID deleted.", "ok"); loadFreshIds(); }
            else toast(data.error || "Delete failed.", "err");
          })
          .catch(function () { toast("Network error.", "err"); });
      });

      var copy = document.createElement("button");
      copy.type = "button";
      copy.className = "btn btn-ghost btn-sm";
      copy.textContent = "Copy ID";
      copy.title = "ID copy karo";
      copy.addEventListener("click", function () {
        copyText(f.user_id_value).then(function () { toast("ID copy ho gayi.", "ok"); });
      });

      row.appendChild(info);
      var actions = document.createElement("div");
      actions.className = "user-actions";
      actions.appendChild(copy);
      actions.appendChild(del);
      row.appendChild(actions);
      freshList.appendChild(row);
    });
  }

  function loadFreshIds() {
    if (!freshList) return;
    fetch("/api/fresh-ids", { headers: { "X-CSRF-Token": csrf } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) renderFreshIds(data.fresh_ids || []);
        else { freshList.innerHTML = '<div class="empty">IDs load nahi ho payi.</div>'; }
      })
      .catch(function () { freshList.innerHTML = '<div class="empty">Network error.</div>'; });
  }

  if (freshForm) {
    freshForm.addEventListener("submit", function (e) {
      e.preventDefault();
      freshIdBtn.disabled = true;
      fetch("/api/fresh-ids", {
        method: "POST",
        headers: { "X-CSRF-Token": csrf },
        body: new FormData(freshForm)
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.success) { toast("ID add ho gayi.", "ok"); freshForm.reset(); loadFreshIds(); }
          else toast(data.error || "ID save nahi ho payi.", "err");
        })
        .catch(function () { toast("Network error.", "err"); })
        .finally(function () { freshIdBtn.disabled = false; });
    });
  }
  if (refreshFreshBtn) refreshFreshBtn.addEventListener("click", loadFreshIds);

  // ---------------- Orders (grouped by class) ----------------
  var orderList = document.getElementById("orderList");
  var refreshOrderBtn = document.getElementById("refreshOrderBtn");
  var CLASS_ORDER = ["1A", "2A", "3A", "3E", "CC", "EC", "SL", "2S", "FC", "EA", "EV", "GN"];

  function orderRow(t) {
    var row = document.createElement("div");
    row.className = "order-row";

    var main = document.createElement("div");
    main.className = "order-main";

    var title = document.createElement("div");
    title.className = "order-title";
    title.textContent = t.t_name || "Ticket";
    main.appendChild(title);

    var route = (t.src || "-") + " \u2192 " + (t.dst || "-");
    var meta = document.createElement("div");
    meta.className = "order-meta muted";
    meta.textContent =
      "Train " + (t.train || "-") + "  \u2022  " + route +
      (t.date ? "  \u2022  " + t.date : "") +
      "  \u2022  " + ((t.passengers || []).length) + " pax" +
      (t.mobile ? "  \u2022  " + t.mobile : "");
    main.appendChild(meta);

    var del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-danger btn-sm";
    del.textContent = "Delete";
    del.addEventListener("click", function () {
      if (!confirm("Order '" + (t.t_name || "") + "' delete karna hai?")) return;
      del.disabled = true;
      fetch("/api/tickets/" + t.id, { method: "DELETE", headers: { "X-CSRF-Token": csrf } })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.success) { toast("Order deleted.", "ok"); loadOrders(); }
          else { toast(data.error || "Delete failed.", "err"); del.disabled = false; }
        })
        .catch(function () { toast("Network error.", "err"); del.disabled = false; });
    });

    row.appendChild(main);
    row.appendChild(del);
    return row;
  }

  function renderOrders(tickets) {
    if (!orderList) return;
    orderList.innerHTML = "";
    var byClass = {};
    tickets.forEach(function (t) {
      var c = (t.cls || "Other").toUpperCase();
      (byClass[c] = byClass[c] || []).push(t);
    });

    var classes = CLASS_ORDER.slice();
    Object.keys(byClass).forEach(function (c) {
      if (classes.indexOf(c) === -1) classes.push(c);
    });

    classes.forEach(function (c) {
      var block = document.createElement("div");
      block.className = "order-class-block";

      var head = document.createElement("div");
      head.className = "order-class-head";
      var label = document.createElement("span");
      label.textContent = c;
      var list = byClass[c] || [];
      var count = document.createElement("span");
      count.className = "order-class-count";
      count.textContent = list.length + " order";
      head.appendChild(label);
      head.appendChild(count);
      block.appendChild(head);

      if (!list.length) {
        var e = document.createElement("div");
        e.className = "empty order-empty";
        e.textContent = "Is class me koi order nahi.";
        block.appendChild(e);
      } else {
        list.forEach(function (t) { block.appendChild(orderRow(t)); });
      }
      orderList.appendChild(block);
    });
  }

  function loadOrders() {
    if (!orderList) return;
    orderList.innerHTML = '<div class="empty">Orders loading...</div>';
    fetch("/api/tickets", { headers: { "X-CSRF-Token": csrf } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) renderOrders(data.tickets || []);
        else orderList.innerHTML = '<div class="empty">Orders load nahi hue.</div>';
      })
      .catch(function () { orderList.innerHTML = '<div class="empty">Network error.</div>'; });
  }

  if (refreshOrderBtn) refreshOrderBtn.addEventListener("click", loadOrders);

  if (pdfList) loadPdfs();
})();