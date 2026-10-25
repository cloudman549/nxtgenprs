(function () {
  "use strict";

  var csrf = document.querySelector('meta[name="csrf-token"]').getAttribute("content");

  var pdfList = document.getElementById("pdfList");
  var emptyState = document.getElementById("emptyState");
  var refreshBtn = document.getElementById("refreshBtn");
  var searchInput = document.getElementById("searchInput");
  var dateFilter = document.getElementById("dateFilter");
  var customDateWrap = document.getElementById("customDateWrap");
  var customDate = document.getElementById("customDate");
  var toastWrap = document.getElementById("toastWrap");

  // Safety checks for null elements
  if (!pdfList || !emptyState || !dateFilter || !toastWrap) {
    console.error("Required dashboard elements missing");
    return; // Exit early if critical elements are missing
  }

  var allPdfs = [];

  function toast(msg, type) {
    var el = document.createElement("div");
    el.className = "toast toast-" + (type || "info");
    el.textContent = msg;
    toastWrap.appendChild(el);
    setTimeout(function () { el.remove(); }, 4500);
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
    if (days <= 0) return "  \u2022  expires today";
    if (days === 1) return "  \u2022  1 din baki";
    return "  \u2022  " + days + " din baki";
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  var ICONS = {
    copy: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
    download: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>',
    share: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
    trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>'
  };

  function renderList(items) {
    if (!pdfList) return; // Safety check
    pdfList.innerHTML = "";
    if (!items.length) {
      var empty = document.createElement("div");
      empty.className = "empty";
      if (allPdfs.length && dateFilter && dateFilter.value === "today") {
        empty.textContent = "Aaj (today) koi PDF upload nahi hui. 'All Days' chun kar pura list dekhein.";
      } else if (allPdfs.length && dateFilter.value === "custom" && customDate && customDate.value) {
        empty.textContent = "Is date pe koi PDF upload nahi hui. 'All Days' chunein.";
      } else if (allPdfs.length && searchInput.value.trim()) {
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
        "  \u2022  " + (formatDate(pdf.uploaded_at)) +
        daysLeft(pdf.expires_at);
      info.appendChild(name);
      info.appendChild(meta);
      if (pdf.access_user || pdf.access_pass) {
        var creds = document.createElement("div");
        creds.className = "pdf-creds";
        var credsText = document.createElement("span");
        credsText.textContent = "User ID: " + (pdf.access_user || "-") + "  \u2022  Password: " + (pdf.access_pass || "-");
        creds.appendChild(credsText);
        if (pdf.access_user) {
          var copy = document.createElement("button");
          copy.type = "button";
          copy.className = "icon-btn";
          copy.title = "User ID copy karo";
          copy.innerHTML = ICONS.copy;
          copy.addEventListener("click", function (e) {
            e.stopPropagation();
            copyText(pdf.access_user).then(function () { toast("User ID copy ho gayi.", "ok"); });
          });
          creds.appendChild(copy);
        }
        info.appendChild(creds);
      }
      main.appendChild(icon);
      main.appendChild(info);

      var actions = document.createElement("div");
      actions.className = "pdf-actions";

      var dl = document.createElement("a");
      dl.className = "icon-btn";
      dl.href = "/api/pdfs/" + pdf.id + "/download";
      dl.title = "Download";
      dl.innerHTML = ICONS.download;

      var share = document.createElement("button");
      share.className = "icon-btn";
      share.type = "button";
      share.title = "Share (10 min)";
      share.innerHTML = ICONS.share;
      share.addEventListener("click", function () {
        share.disabled = true;
        fetch("/api/pdfs/" + pdf.id + "/share", { headers: { "X-CSRF-Token": csrf } })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.success) {
              return copyText(data.url).then(function () {
                toast("Share link copy ho gaya. WhatsApp pe bhejo \u2014 10 min valid. Link khulte hi download shuru ho jayega.", "ok");
              });
            }
            toast((data && data.error) || "Share link nahi bana.", "err");
          })
          .catch(function () { toast("Network error.", "err"); })
          .finally(function () { share.disabled = false; });
      });

      var del = document.createElement("button");
      del.className = "icon-btn icon-danger";
      del.type = "button";
      del.title = "Delete";
      del.innerHTML = ICONS.trash;
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
    var q = (searchInput.value.trim() || "").toLowerCase();
    var filter = dateFilter.value;
    var bounds = getDayBounds(0);

    var items = allPdfs.filter(function (pdf) {
      var name = (pdf.filename || "").toLowerCase();
      if (q && name.indexOf(q) === -1) return false;
      if (filter === "today" && !sameDay(pdf.uploaded_at, bounds.start, bounds.end)) return false;
      return true;
    });

    if (filter === "custom") {
      var dv = customDate ? customDate.value : "";
      if (dv) {
        var parts = dv.split("-");
        var start = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        var end = new Date(start.getTime() + 86400000);
        items = items.filter(function (pdf) {
          return sameDay(pdf.uploaded_at, start, end);
        });
      } else {
        filter = "all";
      }
    }

    renderList(items);
  }

  function loadPdfs() {
    emptyState.classList.remove("hidden");
    emptyState.textContent = "Loading...";
    fetch("/api/pdfs", { headers: { "X-CSRF-Token": csrf } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        emptyState.classList.add("hidden");
        if (data.success) {
          allPdfs = data.pdfs || [];
          renderFiltered();
        }
        else { emptyState.classList.remove("hidden"); emptyState.textContent = "List load nahi ho saki."; }
      })
      .catch(function () {
        emptyState.classList.remove("hidden");
        emptyState.textContent = "Network error. Refresh karein.";
      });
  }

  if (refreshBtn) refreshBtn.addEventListener("click", loadPdfs);
  if (searchInput) searchInput.addEventListener("input", renderFiltered);
  if (dateFilter) {
    dateFilter.addEventListener("change", function () {
      if (customDateWrap) customDateWrap.classList.toggle("hidden", dateFilter.value !== "custom");
      renderFiltered();
    });
  }
  if (customDate) customDate.addEventListener("change", renderFiltered);

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
    if (name === "revenue") loadRevenue();
  }
  dashTabs.forEach(function (t) {
    t.addEventListener("click", function () { showTab(t.getAttribute("data-tab")); });
  });

  var initialTab = new URLSearchParams(window.location.search).get("tab");
  if (initialTab && (initialTab === "fresh" || initialTab === "pdfs" || initialTab === "order" || initialTab === "revenue")) {
    showTab(initialTab);
  }

  // ---------------- Fresh IDs ----------------
  var freshList = document.getElementById("freshList");
  var refreshFreshBtn = document.getElementById("refreshFreshBtn");
  var freshSummary = document.getElementById("freshSummary");
  var freshSelBar = document.getElementById("freshSelBar");
  var freshSelCount = document.getElementById("freshSelCount");
  var freshSelCopyBtn = document.getElementById("freshSelCopy");
  var freshSelClearBtn = document.getElementById("freshSelClear");
  var freshSelOrder = [];
  var freshIdMap = {};

  function updateFreshSelBar() {
    if (!freshSelBar || !freshSelCount) return;
    var n = freshSelOrder.length;
    freshSelCount.textContent = n + " selected";
    freshSelBar.classList.toggle("hidden", n === 0);
  }
  function clearFreshSel() {
    freshSelOrder = [];
    if (freshList) freshList.querySelectorAll(".fw-id.sel").forEach(function (r) { r.classList.remove("sel"); });
    updateFreshSelBar();
  }
  function selToggle(id, row) {
    var i = freshSelOrder.indexOf(id);
    if (i !== -1) {
      freshSelOrder.splice(i, 1);
      row.classList.remove("sel");
    } else {
      freshSelOrder.push(id);
      row.classList.add("sel");
    }
    updateFreshSelBar();
  }
  function copyFreshSel() {
    if (!freshSelOrder.length) { toast("Koi ID select nahi hai.", "err"); return; }
    var lines = freshSelOrder.map(function (id) { return freshIdMap[id] || ""; }).filter(Boolean);
    copyText(lines.join("\n")).then(function () { toast(freshSelOrder.length + " ID(s) copy ho gayi.", "ok"); });
  }
  if (freshSelCopyBtn) freshSelCopyBtn.addEventListener("click", copyFreshSel);
  if (freshSelClearBtn) freshSelClearBtn.addEventListener("click", clearFreshSel);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && freshSelOrder.length) { clearFreshSel(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C") && freshSelOrder.length) {
      e.preventDefault();
      copyFreshSel();
    }
  });

  function freshGroupArr(items) {
    var groups = [];
    items.forEach(function (f) {
      var d = new Date(f.created_at).getTime();
      var last = groups.length ? groups[groups.length - 1] : null;
      if (last && last.items.length && Math.abs(new Date(last.items[0].created_at).getTime() - d) <= 10000) {
        last.items.push(f);
      } else {
        groups.push({ items: [f] });
      }
    });
    return groups;
  }

  function fmtDateTime(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    var h = d.getHours(), m = d.getMinutes();
    var ap = h >= 12 ? "PM" : "AM";
    h = h % 12; if (h === 0) h = 12;
    var mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return String(d.getDate()).padStart(2, "0") + " " + mo[d.getMonth()] + " " + d.getFullYear() +
      ", " + (h < 10 ? "0" + h : h) + ":" + (m < 10 ? "0" + m : m) + " " + ap;
  }

  function renderFreshIds(items) {
    if (!freshList) return;
    if (freshSummary) {
      var now = new Date();
      var today = items.filter(function (f) {
        var d = new Date(f.created_at);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
      }).length;
      freshSummary.innerHTML = "Total ID: <b>" + items.length + "</b> &nbsp;\u2022&nbsp; Aaj (Today): <b>" + today + "</b>";
    }
    clearFreshSel();
    freshIdMap = {};
    freshList.innerHTML = "";
    if (!items.length) {
      var e = document.createElement("div");
      e.className = "empty";
      e.textContent = "Abhi koi Fresh ID add nahi hui.";
      freshList.appendChild(e);
      return;
    }
    freshGroupArr(items).forEach(function (g) {
      var batch = document.createElement("div");
      batch.className = "fw-batch";
      var bubble = document.createElement("div");
      bubble.className = "fw-bubble";

      var head = document.createElement("div");
      head.className = "fw-bubble-head";
      var passgroup = document.createElement("span");
      passgroup.className = "fw-passgroup";
      var pass = document.createElement("span");
      pass.className = "fw-pass";
      pass.innerHTML = "Password: <b>" + esc(g.items[0].password) + "</b>";
      var passCopy = document.createElement("button");
      passCopy.type = "button";
      passCopy.className = "btn btn-ghost btn-sm";
      passCopy.textContent = "Copy Password";
      passCopy.title = "Password copy karo";
      passCopy.addEventListener("click", function () {
        copyText(g.items[0].password).then(function () { toast("Password copy ho gaya.", "ok"); });
      });
      passgroup.appendChild(pass);
      passgroup.appendChild(passCopy);
      var dateChip = document.createElement("span");
      dateChip.className = "fw-date";
      dateChip.textContent = fmtDateTime(g.items[0].created_at);
      head.appendChild(passgroup);
      head.appendChild(dateChip);
      bubble.appendChild(head);

      var count = document.createElement("div");
      count.className = "fw-count";
      count.textContent = g.items.length + (g.items.length === 1 ? " ID" : " IDs") +
        (g.items[0].owner ? " \u2022 " + g.items[0].owner : "");
      bubble.appendChild(count);

      g.items.forEach(function (f) {
        freshIdMap[f.id] = f.user_id_value;
        var row = document.createElement("div");
        row.className = "fw-id";
        var txt = document.createElement("span");
        txt.className = "fw-id-text";
        txt.textContent = f.user_id_value;
        row.appendChild(txt);

        var actions = document.createElement("div");
        actions.className = "fw-id-actions";
        var copy = document.createElement("button");
        copy.type = "button";
        copy.className = "btn btn-ghost btn-sm";
        copy.textContent = "Copy";
        copy.title = "Sirf is ID ko copy karo";
        copy.addEventListener("click", function (e) {
          e.stopPropagation();
          copyText(f.user_id_value).then(function () { toast("ID copy ho gayi.", "ok"); });
        });
        var del = document.createElement("button");
        del.type = "button";
        del.className = "btn btn-danger btn-sm";
        del.textContent = "Del";
        del.addEventListener("click", function (e) {
          e.stopPropagation();
          if (!confirm("ID '" + f.user_id_value + "' delete karni hai?")) return;
          fetch("/api/fresh-ids/" + f.id, { method: "DELETE", headers: { "X-CSRF-Token": csrf } })
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (data.success) { toast("ID deleted.", "ok"); loadFreshIds(); }
              else toast(data.error || "Delete failed.", "err");
            })
            .catch(function () { toast("Network error.", "err"); });
        });
        actions.appendChild(copy);
        actions.appendChild(del);
        row.appendChild(actions);
        row.addEventListener("click", function () { selToggle(f.id, row); });
        bubble.appendChild(row);
      });

      batch.appendChild(bubble);
      freshList.appendChild(batch);
    });
  }

  function loadFreshIds() {
    if (!freshList) return;
    fetch("/api/fresh-ids", { headers: { "X-CSRF-Token": csrf } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) renderFreshIds(data.fresh_ids || []);
        else freshList.innerHTML = '<div class="empty">IDs load nahi ho payi.</div>';
      })
      .catch(function () { freshList.innerHTML = '<div class="empty">Network error.</div>'; });
  }

  if (refreshFreshBtn) refreshFreshBtn.addEventListener("click", loadFreshIds);

  // ---------------- Orders (filter + full detail + click-to-copy) ----------------
  var orderList = document.getElementById("orderList");
  var orderQuotaChips = document.getElementById("orderQuotaChips");
  var orderClassChips = document.getElementById("orderClassChips");
  var orderFromInput = document.getElementById("orderFromInput");
  var orderToInput = document.getElementById("orderToInput");
  var orderTrainInput = document.getElementById("orderTrainInput");
  var orderDateFilter = document.getElementById("orderDateFilter");
  var orderCustomDate = document.getElementById("orderCustomDate");
  var orderCustomDateWrap = document.getElementById("orderCustomDateWrap");
  var orderJourneyDate = document.getElementById("orderJourneyDate");
  var refreshOrderBtn = document.getElementById("refreshOrderBtn");
  var allTickets = [];
  var orderQuota = "";
  var orderClass = "";
  var orderDateMode = "all";
  var orderSummary = document.getElementById("orderSummary");

  function localIso(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function createdIso(t) {
    var d = new Date(t.created_at);
    return isNaN(d.getTime()) ? "" : localIso(d);
  }

  function nextDayIso(iso) {
    var p = String(iso || "").split("-");
    if (p.length !== 3) return "";
    var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10) + 1);
    return localIso(d);
  }

  function journeyMatch(t, jd) {
    var td = String(t.date || "").trim();
    if (t.starred) return td === nextDayIso(jd);
    return td === jd;
  }

  function orderFilterPass(t) {
    if (orderQuota && (t.quota || "GN").toUpperCase() !== orderQuota) return false;
    if (orderClass) {
      var cl = String(t.cls || "").toUpperCase();
      var clsOk = false;
      if (orderClass === "SL") clsOk = (cl === "SL" || cl === "2S");
      else if (orderClass === "AC") clsOk = ["1A", "2A", "3A", "3E", "CC", "EC"].indexOf(cl) !== -1;
      else clsOk = (cl === orderClass);
      if (!clsOk) return false;
    }
    var v = orderFromInput ? orderFromInput.value.trim().toLowerCase() : "";
    if (v && !String(t.src || "").toLowerCase().includes(v)) return false;
    v = orderToInput ? orderToInput.value.trim().toLowerCase() : "";
    if (v && !String(t.dst || "").toLowerCase().includes(v)) return false;
    v = orderTrainInput ? orderTrainInput.value.trim().toLowerCase() : "";
    if (v && !String(t.train || "").toLowerCase().includes(v)) return false;
    var jd = orderJourneyDate ? orderJourneyDate.value : "";
    if (jd) {
      return journeyMatch(t, jd);
    }
    if (orderDateMode === "today" && createdIso(t) !== localIso(new Date())) return false;
    if (orderDateMode === "custom" && orderCustomDate.value && createdIso(t) !== orderCustomDate.value) return false;
    return true;
  }

  function copyField(text) {
    var v = String(text == null ? "" : text);
    if (!v) return;
    copyText(v).then(function () { toast('"' + v + '" copy ho gaya.', "ok"); });
  }

  function copyCell(val) {
    var s = document.createElement("span");
    s.className = "copy-cell";
    s.textContent = val;
    s.title = "Click to copy";
    s.addEventListener("click", function () { copyField(val); });
    return s;
  }

  function fieldRow(label, value) {
    var r = document.createElement("div");
    r.className = "detail-row";
    var l = document.createElement("span");
    l.className = "detail-label";
    l.textContent = label;
    r.appendChild(l);
    r.appendChild(copyCell(value == null || value === "" ? "-" : String(value)));
    return r;
  }

  function formField(label, value) {
    var w = document.createElement("label");
    w.className = "field pop-field";
    var s = document.createElement("span");
    s.textContent = label;
    w.appendChild(s);
    w.appendChild(copyCell(value == null || value === "" ? "-" : String(value)));
    return w;
  }

  function openOrderDetail(t, num) {
    var body = document.getElementById("orderModalBody");
    var title = document.getElementById("orderModalTitle");
    if (!body) return;
    title.textContent = "Card " + num + " \u2014 " + (t.t_name || "Ticket");

    body.innerHTML = "";

    var head = document.createElement("h3");
    head.className = "form-section-title";
    head.textContent = "Passenger Details";
    body.appendChild(head);
    var wrap = document.createElement("div");
    wrap.className = "table-scroll";
    var table = document.createElement("table");
    table.className = "pass-table";
    var thead = document.createElement("thead");
    thead.innerHTML = "<tr><th>#</th><th>Name</th><th>Age</th><th>Sex</th><th>Choice Birth</th></tr>";
    table.appendChild(thead);
    var tbody = document.createElement("tbody");
    (t.passengers || []).forEach(function (p, i) {
      var tr = document.createElement("tr");
      tr.appendChild(copyCell(String(i + 1)));
      tr.appendChild(copyCell(p.name || "-"));
      tr.appendChild(copyCell(p.age || "-"));
      tr.appendChild(copyCell(p.gender || "-"));
      tr.appendChild(copyCell(p.berth || "-"));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    body.appendChild(wrap);

    var grid1 = document.createElement("div");
    grid1.className = "pop-grid";
    grid1.appendChild(formField("From", t.src));
    grid1.appendChild(formField("To", t.dst));
    grid1.appendChild(formField("Journey Date", t.date));
    body.appendChild(grid1);

    var grid2 = document.createElement("div");
    grid2.className = "pop-grid";
    grid2.appendChild(formField("Boarding", t.boarding));
    grid2.appendChild(formField("Train No.", t.train));
    grid2.appendChild(formField("Class", t.cls));
    grid2.appendChild(formField("Quota", t.quota));
    grid2.appendChild(formField("Train Type", t.train_type));
    body.appendChild(grid2);

    var grid3 = document.createElement("div");
    grid3.className = "pop-grid";
    grid3.appendChild(formField("1st Passenger Mobile No.", t.mobile));
    grid3.appendChild(formField("2nd Alternative", t.alt_mobile));
    body.appendChild(grid3);

    var grid4 = document.createElement("div");
    grid4.className = "pop-grid";
    grid4.appendChild(formField("Payment", t.pay === "Advanced" ? "Advanced Paid" : "Unpaid"));
    grid4.appendChild(formField("Total", t.total ? "Rs" + t.total : "-"));
    grid4.appendChild(formField("Advanced Paid", t.pay === "Advanced" && t.adv_amount ? "Rs" + t.adv_amount : "-"));
    grid4.appendChild(formField(t.failed ? "Due (cancelled)" : "Due", dueOf(t)));
    grid4.appendChild(formField("Description", t.desc));
    body.appendChild(grid4);

    if (t.failed) {
      var gridFail = document.createElement("div");
      gridFail.className = "pop-grid";
      gridFail.appendChild(formField("Status", "FAILED / CANCELLED"));
      gridFail.appendChild(formField("Failed On", t.failed_date || "-"));
      gridFail.appendChild(formField("Return Amount", t.refund_amount !== "" && t.refund_amount != null ? "Rs" + t.refund_amount : "-"));
      gridFail.appendChild(formField("Return Mode", t.refund_mode || "-"));
      if (t.refund_note) gridFail.appendChild(formField("Return Note", t.refund_note));
      body.appendChild(gridFail);
    }

    var av = t.avail_info || {};
    if (av.fare || av.status) {
      var grid5 = document.createElement("div");
      grid5.className = "pop-grid";
      grid5.appendChild(formField("Fare (checked)", av.fare ? "Rs" + av.fare : "-"));
      grid5.appendChild(formField("Availability", av.status || "-"));
      body.appendChild(grid5);
    }

    document.getElementById("orderModal").classList.remove("hidden");
  }

  function closeOrderModal() {
    var m = document.getElementById("orderModal");
    if (m) m.classList.add("hidden");
  }
  var orderModalClose = document.getElementById("orderModalClose");
  if (orderModalClose) orderModalClose.addEventListener("click", closeOrderModal);
  var orderModalBox = document.getElementById("orderModal");
  if (orderModalBox) orderModalBox.addEventListener("click", function (e) {
    if (e.target === orderModalBox) closeOrderModal();
  });

  function dueOf(t) {
    var total = parseInt((t.total || "0").replace(/\D/g, ""), 10) || 0;
    var adv = t.pay === "Advanced" ? (parseInt((t.adv_amount || "0").replace(/\D/g, ""), 10) || 0) : 0;
    var due = total - adv;
    return (due > 0 ? "Rs" + due : (total > 0 ? "Rs0" : "-"));
  }

  function detailHtml(t) {
    var box = document.createElement("div");
    box.className = "order-detail-inner";
    var pairs = [
      ["Ticket Name", t.t_name],
      ["Train No.", t.train],
      ["From", t.src],
      ["To", t.dst],
      ["Class", t.cls],
      ["Quota", t.quota],
      ["Journey Date", t.date],
      ["Boarding", t.boarding],
      ["Mobile", t.mobile],
      ["Alt Mobile", t.alt_mobile],
      ["Payment", t.pay || "Unpaid"],
      ["Total", t.total ? "Rs" + t.total : "-"],
      ["Advanced Paid", t.pay === "Advanced" && t.adv_amount ? "Rs" + t.adv_amount : "-"],
      ["Due", dueOf(t)],
      ["Description", t.desc]
    ];
    if (t.failed) {
      pairs.push(["Status", "FAILED / CANCELLED"]);
      pairs.push(["Failed On", t.failed_date || "-"]);
      pairs.push(["Return Amount", t.refund_amount !== "" && t.refund_amount != null ? "Rs" + t.refund_amount : "-"]);
      pairs.push(["Return Mode", t.refund_mode || "-"]);
      if (t.refund_note) pairs.push(["Return Note", t.refund_note]);
    }
    if (t.emp_name) pairs.splice(1, 0, ["Order Receiver", t.emp_name]);
    pairs.forEach(function (p) { box.appendChild(fieldRow(p[0], p[1])); });

    var pax = t.passengers || [];
    if (pax.length) {
      var ph = document.createElement("div");
      ph.className = "detail-pax-head";
      ph.textContent = "Passengers (" + pax.length + ")";
      box.appendChild(ph);
      pax.forEach(function (p, i) {
        var r = document.createElement("div");
        r.className = "detail-row";
        r.appendChild(copyCell(String(i + 1)));
        r.appendChild(copyCell(p.name || "-"));
        r.appendChild(copyCell(p.age || "-"));
        r.appendChild(copyCell(p.gender || "-"));
        r.appendChild(copyCell(p.berth || "-"));
        box.appendChild(r);
      });
    }
    return box;
  }

  function orderRow(t, num) {
    var row = document.createElement("div");
    row.className = "order-row" + (t.booked ? " booked" : "") + (t.starred ? " starred" : "")
      + (t.failed ? " failed" : "");

    var head = document.createElement("div");
    head.className = "order-head";

    var main = document.createElement("div");
    main.className = "order-main";
    var title = document.createElement("div");
    title.className = "order-title";
    title.textContent = (t.starred ? "\u2605 " : "") + "CARD-" + num + "-" + (t.t_name || "TICKET");
    if (t.failed) {
      var failChip = document.createElement("span");
      failChip.className = "tag-failed";
      failChip.textContent = "FAILED";
      title.appendChild(failChip);
    }
    main.appendChild(title);
    var meta = document.createElement("div");
    meta.className = "order-meta muted";
    meta.textContent =
      "Train " + (t.train || "-") + "  \u2022  " + (t.src || "-") + " \u2192 " + (t.dst || "-") +
      (t.date ? "  \u2022  " + t.date : "") +
      "  \u2022  " + (t.cls || "-") +
      "  \u2022  " + (t.quota || "GN") +
      "  \u2022  " + ((t.passengers || []).length) + " pax";
    main.appendChild(meta);
    head.appendChild(main);

    var actions = document.createElement("div");
    actions.className = "order-actions";

    var star = document.createElement("button");
    star.type = "button";
    star.className = "star-btn" + (t.booked ? " active" : "");
    star.textContent = "\u2605";
    star.title = t.booked ? "Ticket book ho gayi (star hatao)" : "Ticket book ho jaye to star lagao";
    star.addEventListener("click", function () {
      var next = !t.booked;
      star.classList.add("loading");
      fetch("/api/tickets/" + t.id + "/booked", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ booked: next })
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.success) {
            t.booked = next;
            star.classList.toggle("active", next);
            row.classList.toggle("booked", next);
            star.title = next ? "Ticket book ho gayi (star hatao)" : "Ticket book ho jaye to star lagao";
            toast(next ? "Star lag gaya \u2014 booked." : "Star hata diya.", "ok");
          } else {
            toast((data && data.error) || "Update nahi hua.", "err");
          }
        })
        .catch(function () { toast("Network error.", "err"); })
        .finally(function () { star.classList.remove("loading"); });
    });

    var detail = document.createElement("button");
    detail.type = "button";
    detail.className = "btn btn-primary btn-sm";
    detail.textContent = "Detail";
    detail.addEventListener("click", function () { openOrderDetail(t, num); });

    var edt = document.createElement("button");
    edt.type = "button";
    edt.className = "btn btn-sm";
    edt.textContent = "Edit";
    edt.addEventListener("click", function () {
      location.href = "/ticket/new?edit=" + encodeURIComponent(t.id);
    });

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

    actions.appendChild(star);
    actions.appendChild(detail);
    actions.appendChild(edt);
    actions.appendChild(del);
    head.appendChild(actions);
    row.appendChild(head);
    return row;
  }

  function renderOrders() {
    if (!orderList) return;
    orderList.innerHTML = "";
    var todayIso = localIso(new Date());
    var items = allTickets.filter(orderFilterPass);
    if (orderSummary) {
      var jd = orderJourneyDate ? orderJourneyDate.value : "";
      var todayN = allTickets.filter(function (t) { return createdIso(t) === todayIso; }).length;
      var text = "Today: " + todayN + "  \u2022  All Days: " + allTickets.length;
      if (jd) {
        var starN = allTickets.filter(function (t) { return t.starred && String(t.date || "").trim() === nextDayIso(jd); }).length;
        text += "  \u2022  Journey " + jd + ": " + items.length + "  \u2022  Star (+1d): " + starN;
      } else if (orderDateMode === "custom" && orderCustomDate.value) {
        text += "  \u2022  " + orderCustomDate.value + ": " + items.length;
      }
      orderSummary.textContent = text;
    }
    if (!items.length) {
      var e = document.createElement("div");
      e.className = "empty";
      e.textContent = "Is filter me koi order nahi mila.";
      orderList.appendChild(e);
      return;
    }
    items.forEach(function (t, i) { orderList.appendChild(orderRow(t, i + 1)); });
  }

  function loadOrders() {
    if (!orderList) return;
    orderList.innerHTML = '<div class="empty">Orders loading...</div>';
    fetch("/api/tickets", { headers: { "X-CSRF-Token": csrf } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) {
          allTickets = data.tickets || [];
          renderOrders();
        }
        else orderList.innerHTML = '<div class="empty">Orders load nahi hue.</div>';
      })
      .catch(function () { orderList.innerHTML = '<div class="empty">Network error.</div>'; });
  }

  if (orderQuotaChips) {
    orderQuotaChips.addEventListener("click", function (e) {
      var chip = e.target.closest(".order-chip");
      if (!chip) return;
      orderQuotaChips.querySelectorAll(".order-chip").forEach(function (c) { c.classList.remove("active"); });
      chip.classList.add("active");
      orderQuota = chip.getAttribute("data-q") || "";
      renderOrders();
    });
  }
  if (orderClassChips) {
    orderClassChips.addEventListener("click", function (e) {
      var chip = e.target.closest(".order-chip");
      if (!chip) return;
      orderClassChips.querySelectorAll(".order-chip").forEach(function (c) { c.classList.remove("active"); });
      chip.classList.add("active");
      orderClass = chip.getAttribute("data-cls") || "";
      renderOrders();
    });
  }
  if (orderDateFilter) {
    orderDateFilter.addEventListener("change", function () {
      orderDateMode = orderDateFilter.value;
      if (orderCustomDateWrap) orderCustomDateWrap.classList.toggle("hidden", orderDateMode !== "custom");
      renderOrders();
    });
  }
  if (orderCustomDate) orderCustomDate.addEventListener("change", renderOrders);
  if (orderJourneyDate) orderJourneyDate.addEventListener("change", renderOrders);
  if (orderFromInput) orderFromInput.addEventListener("input", renderOrders);
  if (orderToInput) orderToInput.addEventListener("input", renderOrders);
  if (orderTrainInput) orderTrainInput.addEventListener("input", renderOrders);
  if (refreshOrderBtn) refreshOrderBtn.addEventListener("click", loadOrders);

  // ---------------- Download Order PDF ----------------
  var downloadOrderPdfBtn = document.getElementById("downloadOrderPdfBtn");
  if (downloadOrderPdfBtn) {
    downloadOrderPdfBtn.addEventListener("click", function () {
      var todayIso = localIso(new Date());
      var jd = orderJourneyDate ? orderJourneyDate.value : "";
      var label = jd || (orderDateMode === "today" ? todayIso
        : (orderDateMode === "custom" && orderCustomDate.value ? orderCustomDate.value : "All Days"));
      var ids = allTickets.filter(orderFilterPass).map(function (t) { return t.id; });
      if (!ids.length) { toast("Filter se koi order nahi mila.", "err"); return; }
      downloadOrderPdfBtn.disabled = true;
      downloadOrderPdfBtn.textContent = "PDF ban raha hai...";
      fetch("/api/tickets/export", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ ids: ids, label: label })
      })
        .then(function (r) {
          if (!r.ok) return r.json().then(function (d) { throw new Error((d && d.error) || "PDF nahi bani."); });
          return r.blob();
        })
        .then(function (blob) {
          var url = URL.createObjectURL(blob);
          var a = document.createElement("a");
          a.href = url;
          a.download = "Orders-" + label.replace(/[\\/]/g, "-") + ".pdf";
          document.body.appendChild(a);
          a.click();
          setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1200);
          toast("Order PDF download ho gayi.", "ok");
        })
        .catch(function (err) { toast(err.message || "PDF nahi bani.", "err"); })
        .finally(function () {
          downloadOrderPdfBtn.disabled = false;
          downloadOrderPdfBtn.textContent = "Download Order PDF";
        });
    });
  }

  // ---------------- Revenue (A4 hisab kitab + accept due) ----------------
  var ledgerPaper = document.getElementById("ledgerPaper");
  var revDateFilter = document.getElementById("revDateFilter");
  var revCustomDate = document.getElementById("revCustomDate");
  var revCustomWrap = document.getElementById("revCustomWrap");
  var revNote = document.getElementById("revNote");
  var revRefreshBtn = document.getElementById("revRefreshBtn");
  var revDueBtn = document.getElementById("revDueBtn");
  var revPdfBtn = document.getElementById("revPdfBtn");
  var revPrintBtn = document.getElementById("revPrintBtn");
  var revDateMode = "today";
  var revTickets = [];
  var revDues = [];
  var revBackDate = "";

  var dueModal = document.getElementById("dueModal");
  var dueModalClose = document.getElementById("dueModalClose");
  var dueDateModeEl = document.getElementById("dueDateMode");
  var dueCustomWrap = document.getElementById("dueCustomWrap");
  var dueCustomDate = document.getElementById("dueCustomDate");
  var dueDateHint = document.getElementById("dueDateHint");
  var dueOrderSelect = document.getElementById("dueOrderSelect");
  var dueAmountInput = document.getElementById("dueAmountInput");
  var dueModeSelect = document.getElementById("dueModeSelect");
  var dueNoteInput = document.getElementById("dueNoteInput");
  var dueAcceptBtn = document.getElementById("dueAcceptBtn");
  var dueAcceptMsg = document.getElementById("dueAcceptMsg");
  var failTicketSelect = document.getElementById("failTicketSelect");
  var failTicketInfo = document.getElementById("failTicketInfo");
  var failAmountInput = document.getElementById("failAmountInput");
  var failModeSelect = document.getElementById("failModeSelect");
  var failNoteInput = document.getElementById("failNoteInput");
  var failBtn = document.getElementById("failBtn");
  var failMsg = document.getElementById("failMsg");
  var failList = document.getElementById("failList");

  var REV_MODES = ["Cash", "Scan QR", "PhonePe", "Kausher Pe", "Chacha Pe"];

  function amt(v) {
    return parseInt(String(v == null ? "" : v).replace(/\D/g, ""), 10) || 0;
  }

  function money(n) {
    return "Rs. " + Math.round(n || 0).toLocaleString("en-IN");
  }

  function num(n) {
    return Math.round(n || 0).toLocaleString("en-IN");
  }

  function isoDaysAgo(n) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    return localIso(d);
  }

  function dmy(iso) {
    var p = String(iso || "").split("-");
    return p.length === 3 ? (p[2] + "-" + p[1] + "-" + p[0]) : "-";
  }

  function inWords(num) {
    num = Math.round(Math.abs(num || 0));
    if (!num) return "Zero";
    var one = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
      "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
    var ten = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
    function two(n) {
      if (n < 20) return one[n];
      return ten[Math.floor(n / 10)] + (n % 10 ? " " + one[n % 10] : "");
    }
    function three(n) {
      var out = "";
      if (n >= 100) {
        out = one[Math.floor(n / 100)] + " Hundred";
        n %= 100;
        if (n) out += " ";
      }
      return out + two(n);
    }
    var parts = [];
    var crore = Math.floor(num / 10000000); num %= 10000000;
    var lakh = Math.floor(num / 100000); num %= 100000;
    var thousand = Math.floor(num / 1000); num %= 1000;
    if (crore) parts.push(three(crore) + " Crore");
    if (lakh) parts.push(three(lakh) + " Lakh");
    if (thousand) parts.push(three(thousand) + " Thousand");
    if (num) parts.push(three(num));
    return parts.join(" ");
  }

  function revMainDate() {
    if (revDateMode === "all") return null;
    if (revDateMode === "custom") {
      return revCustomDate && revCustomDate.value ? revCustomDate.value : localIso(new Date());
    }
    return localIso(new Date());
  }

  function revRangeLabel() {
    if (revDateMode === "today") return "Today (" + localIso(new Date()) + ")";
    if (revDateMode === "custom" && revCustomDate && revCustomDate.value) return revCustomDate.value;
    return "All Days";
  }

  function duePaidMap() {
    var map = {};
    revDues.forEach(function (d) {
      var id = String(d.ticket_id || "");
      map[id] = (map[id] || 0) + amt(d.amount);
    });
    return map;
  }

  function revInfo(t, map) {
    var total = amt(t.total);
    var adv = String(t.pay || "") === "Advanced" ? amt(t.adv_amount) : 0;
    if (adv > total) total = adv;
    var due = Math.max(total - adv, 0);
    var rawPaid = map[String(t.id || "")] || 0;
    var paid = Math.max(0, Math.min(rawPaid, due));
    var failed = !!t.failed;
    var refund = 0;
    if (failed) {
      refund = (t.refund_amount !== undefined && t.refund_amount !== null && t.refund_amount !== "")
        ? amt(t.refund_amount) : (adv + paid);
    }
    return {
      total: total,
      adv: adv,
      due: due,
      paid: paid,
      rawPaid: rawPaid,
      remaining: failed ? 0 : Math.max(due - paid, 0),
      failed: failed,
      refund: refund,
      mode: String(t.pay_mode || "").trim() || "Not set",
      refundMode: String(t.refund_mode || "").trim() || "Not set",
      orderDate: createdIso(t)
    };
  }

  function buildLedger(mainDate) {
    var paidMap = duePaidMap();
    var main = {}, flow = {}, back = {};
    var mt = { orders: 0, total: 0, adv: 0, due: 0, paid: 0, remaining: 0, advOrders: 0, dueOrders: 0 };
    var bt = { orders: 0, total: 0, adv: 0, due: 0, paid: 0, remaining: 0 };
    var ft = { adv: 0, due_mila: 0, ret: 0, net: 0 };
    var fails = [], backFails = [];
    var keys = ["orders", "total", "adv", "due", "paid", "remaining"];

    function bucket(store, mode) {
      if (!store[mode]) store[mode] = { orders: 0, total: 0, adv: 0, due: 0, paid: 0, remaining: 0 };
      return store[mode];
    }
    function flowBucket(mode) {
      if (!flow[mode]) flow[mode] = { adv: 0, due_mila: 0, ret: 0 };
      return flow[mode];
    }

    revTickets.forEach(function (t) {
      var info = revInfo(t, paidMap);
      var inMain = mainDate === null || info.orderDate === mainDate;

      if (inMain && info.adv > 0) flowBucket(info.mode).adv += info.adv;

      if (inMain && !info.failed) {
        var b = bucket(main, info.mode);
        keys.forEach(function (k) {
          var v = k === "orders" ? 1 : info[k];
          b[k] += v;
          mt[k] += v;
        });
        if (info.adv > 0) mt.advOrders += 1;
        if (info.remaining > 0) mt.dueOrders += 1;
      }

      if (revBackDate && info.orderDate === revBackDate && !info.failed) {
        var bb = bucket(back, info.mode);
        keys.forEach(function (k) {
          var v = k === "orders" ? 1 : info[k];
          bb[k] += v;
          bt[k] += v;
        });
      }

      if (info.failed) {
        var row = {
          name: t.t_name || "",
          orderDate: info.orderDate,
          failedDate: String(t.failed_date || ""),
          mode: info.refundMode,
          adv: info.adv,
          dueCancelled: Math.max(info.due - info.paid, 0),
          refund: info.refund
        };
        if (inMain || (mainDate !== null && row.failedDate === mainDate)) fails.push(row);
        if (revBackDate && info.orderDate === revBackDate) backFails.push(row);
        if ((mainDate === null || row.failedDate === mainDate) && info.refund > 0) {
          flowBucket(info.refundMode).ret += info.refund;
        }
      }
    });

    revDues.forEach(function (d) {
      if (mainDate !== null && String(d.accepted_date || "") !== mainDate) return;
      var mode = String(d.pay_mode || "").trim() || "Not set";
      flowBucket(mode).due_mila += amt(d.amount);
    });

    Object.keys(flow).forEach(function (k) {
      ft.adv += flow[k].adv;
      ft.due_mila += flow[k].due_mila;
      ft.ret += flow[k].ret;
    });
    ft.net = ft.adv + ft.due_mila - ft.ret;

    function modeKeys(store) {
      var out = REV_MODES.filter(function (m) { return store[m]; });
      Object.keys(store).sort().forEach(function (k) {
        if (out.indexOf(k) === -1) out.push(k);
      });
      return out;
    }
    function rows(store) {
      return modeKeys(store).map(function (k) {
        var r = { mode: k };
        Object.keys(store[k]).forEach(function (x) { r[x] = store[k][x]; });
        return r;
      });
    }

    return {
      mainRows: rows(main),
      mainTot: mt,
      flowRows: rows(flow),
      flowTot: ft,
      backRows: rows(back),
      backTot: bt,
      fails: fails,
      backFails: backFails
    };
  }

  function renderRevenue() {
    if (!ledgerPaper) return;
    var mainDate = revMainDate();
    var led = buildLedger(mainDate);
    var mt = led.mainTot;
    var ft = led.flowTot;
    var bt = led.backTot;

    function box(k, v, cls) {
      return '<div class="ledger-box' + (cls ? " " + cls : "") + '"><div class="k">' + esc(k)
        + '</div><div class="v">' + esc(v) + '</div></div>';
    }

    var now = new Date();
    var dayStamp = now.toLocaleDateString("en-GB");
    var timeStamp = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

    var html = '<div class="ledger-head">'
      + '<div><div class="ledger-title">HISAB KITAB</div>'
      + '<div class="ledger-sub">Revenue &middot; ' + esc(revRangeLabel()) + '</div></div>'
      + '<div class="ledger-meta"><div>' + mt.orders + ' order</div><div>' + esc(dayStamp + ", " + timeStamp) + '</div></div>'
      + '</div>';

    html += '<div class="ledger-summary">'
      + box("Total Order", String(mt.orders))
      + box("Total Amount", money(mt.total))
      + box("Advanced Mila", money(mt.adv))
      + box("Baki Due", money(mt.remaining))
      + '</div>';

    html += '<div class="ledger-sec">Kis mode me kitna <span class="ledger-sec-note">(rashi Rs. me)</span></div>'
      + '<div class="ledger-scroll"><table class="ledger-table compact"><thead><tr>'
      + '<th>Payment Mode</th><th class="num">Order</th><th class="num">Advanced</th>'
      + '<th class="num">Due Bana</th><th class="num">Due Mila</th><th class="num">Due Baki</th>'
      + '<th class="num">Due + Advanced</th>'
      + '</tr></thead><tbody>';
    if (!led.mainRows.length) {
      html += '<tr><td colspan="7" class="ledger-empty">Is date ka koi order nahi hai.</td></tr>';
    } else {
      led.mainRows.forEach(function (r) {
        html += '<tr><td>' + esc(r.mode) + '</td><td class="num">' + r.orders + '</td>'
          + '<td class="num">' + num(r.adv) + '</td><td class="num">' + num(r.due) + '</td>'
          + '<td class="num">' + num(r.paid) + '</td><td class="num">' + num(r.remaining) + '</td>'
          + '<td class="num">' + num(r.adv + r.due) + '</td></tr>';
      });
    }
    html += '</tbody><tfoot><tr class="total"><td>Total</td><td class="num">' + mt.orders + '</td>'
      + '<td class="num">' + num(mt.adv) + '</td><td class="num">' + num(mt.due) + '</td>'
      + '<td class="num">' + num(mt.paid) + '</td><td class="num">' + num(mt.remaining) + '</td>'
      + '<td class="num">' + num(mt.adv + mt.due) + '</td></tr></tfoot></table></div>';

    html += '<div class="ledger-sec">Is date par paisa <span class="ledger-sec-note">(advanced + purana due mila - fail return)</span></div>'
      + '<div class="ledger-summary three">'
      + box("Purana Due Mila", money(ft.due_mila))
      + box("Fail Return", money(ft.ret))
      + box("Net Cash", money(ft.net))
      + '</div>'
      + '<div class="ledger-scroll"><table class="ledger-table compact"><thead><tr>'
      + '<th>Payment Mode</th><th class="num">Naya Advanced</th><th class="num">Purana Due Mila</th>'
      + '<th class="num">Fail Return</th><th class="num">Net</th>'
      + '</tr></thead><tbody>';
    if (!led.flowRows.length) {
      html += '<tr><td colspan="5" class="ledger-empty">Is date par koi cash movement nahi.</td></tr>';
    } else {
      led.flowRows.forEach(function (r) {
        var net = r.adv + r.due_mila - r.ret;
        html += '<tr><td>' + esc(r.mode) + '</td><td class="num">' + num(r.adv) + '</td>'
          + '<td class="num">' + num(r.due_mila) + '</td><td class="num">' + num(r.ret) + '</td>'
          + '<td class="num">' + num(net) + '</td></tr>';
      });
    }
    html += '</tbody><tfoot><tr class="total"><td>Total</td><td class="num">' + num(ft.adv) + '</td>'
      + '<td class="num">' + num(ft.due_mila) + '</td><td class="num">' + num(ft.ret) + '</td>'
      + '<td class="num">' + num(ft.net) + '</td></tr></tfoot></table></div>';

    if (led.fails.length) {
      html += '<div class="ledger-sec">Fail / Return ticket <span class="ledger-sec-note">(due cancel + paisa wapas)</span></div>'
        + '<div class="ledger-scroll"><table class="ledger-table compact"><thead><tr>'
        + '<th>Ticket</th><th>Order</th><th>Fail</th><th>Mode</th>'
        + '<th class="num">Return</th><th class="num">Due Cancel</th>'
        + '</tr></thead><tbody>';
      led.fails.forEach(function (r) {
        html += '<tr><td>' + esc(r.name || "-") + '</td><td>' + esc(dmy(r.orderDate)) + '</td>'
          + '<td>' + esc(dmy(r.failedDate)) + '</td><td>' + esc(r.mode) + '</td>'
          + '<td class="num">' + num(r.refund) + '</td><td class="num">' + num(r.dueCancelled) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }

    html += '<div class="ledger-sec ledger-back-head">Pichhle date ka hisab <span class="ledger-sec-note">(back date ' + esc(dmy(revBackDate)) + ')</span></div>';
    if (mainDate && revBackDate === mainDate) {
      html += '<div class="ledger-empty">Back date selected date ke barabar hai. Accept Due me doosri date chunein.</div>';
    } else {
      html += '<div class="ledger-scroll"><table class="ledger-table compact"><thead><tr>'
        + '<th>Payment Mode</th><th class="num">Order</th><th class="num">Advanced</th>'
        + '<th class="num">Due Bana</th><th class="num">Due Mila</th><th class="num">Due Baki</th>'
        + '</tr></thead><tbody>';
      if (!led.backRows.length) {
        html += '<tr><td colspan="6" class="ledger-empty">Us date ka koi order nahi hai.</td></tr>';
      } else {
        led.backRows.forEach(function (r) {
          html += '<tr><td>' + esc(r.mode) + '</td><td class="num">' + r.orders + '</td>'
            + '<td class="num">' + num(r.adv) + '</td><td class="num">' + num(r.due) + '</td>'
            + '<td class="num">' + num(r.paid) + '</td><td class="num">' + num(r.remaining) + '</td></tr>';
        });
      }
      html += '</tbody><tfoot><tr class="total"><td>Total</td><td class="num">' + bt.orders + '</td>'
        + '<td class="num">' + num(bt.adv) + '</td><td class="num">' + num(bt.due) + '</td>'
        + '<td class="num">' + num(bt.paid) + '</td><td class="num">' + num(bt.remaining) + '</td>'
        + '</tr></tfoot></table></div>';
      led.backFails.forEach(function (r) {
        html += '<div class="ledger-fail-line">Fail: ' + esc(r.name || "-") + ' &middot; return '
          + money(r.refund) + ' &middot; due cancel ' + money(r.dueCancelled) + '</div>';
      });
    }

    html += '<div class="ledger-words">'
      + '<div>Order ka kul (Due + Advanced): <b>' + money(mt.adv + mt.due) + '</b></div>'
      + '<div>Advanced mila: <b>' + money(mt.adv) + '</b></div>'
      + '<div>Purana due mila: <b>' + money(ft.due_mila) + '</b></div>'
      + '<div>Fail return: <b>' + money(ft.ret) + '</b></div>'
      + '<div>Net cash (advanced + due mila - return): <b>' + money(ft.net) + '</b></div>'
      + '<div class="ledger-inwords">Shabd me: <i>Rupees ' + esc(inWords(ft.net)) + ' only</i></div>'
      + '</div>';

    html += '<div class="ledger-sign"><span>Signature</span><span>Date: ' + esc(dayStamp) + '</span></div>';

    ledgerPaper.innerHTML = html;
    if (revNote) {
      revNote.textContent = mt.orders + " order \u2022 " + revRangeLabel()
        + " \u2022 net cash " + money(ft.net);
    }
  }

  function loadRevenue() {
    if (!ledgerPaper) return Promise.resolve();
    ledgerPaper.innerHTML = '<div class="empty">Hisab loading...</div>';
    return Promise.all([
      fetch("/api/tickets", { headers: { "X-CSRF-Token": csrf } }).then(function (r) { return r.json(); }),
      fetch("/api/dues", { headers: { "X-CSRF-Token": csrf } }).then(function (r) {
        return r.ok ? r.json() : { success: false, dues: [] };
      }).catch(function () { return { success: false, dues: [] }; })
    ])
      .then(function (res) {
        var data = res[0] || {};
        if (!data.success) throw new Error(data.error || "Hisab load nahi hua.");
        revTickets = data.tickets || [];
        revDues = (res[1] && res[1].success) ? (res[1].dues || []) : [];
        if (!revBackDate) revBackDate = isoDaysAgo(1);
        renderRevenue();
        if (dueModal && !dueModal.classList.contains("hidden")) renderDuePanel();
      })
      .catch(function (err) {
        ledgerPaper.innerHTML = '<div class="empty">' + esc((err && err.message) || "Network error.") + '</div>';
      });
  }

  // ---------------- Accept Due / Fail modal ----------------
  function dueSelectedDate() {
    if (dueDateModeEl && dueDateModeEl.value === "custom" && dueCustomDate && dueCustomDate.value) {
      return dueCustomDate.value;
    }
    return isoDaysAgo(1);
  }

  function ticketBySelect(sel) {
    if (!sel || !sel.value) return null;
    var id = sel.value;
    for (var i = 0; i < revTickets.length; i++) {
      if (String(revTickets[i].id) === id) return revTickets[i];
    }
    return null;
  }

  function fillModeSelect(sel) {
    if (!sel) return;
    var current = sel.value;
    sel.innerHTML = "";
    REV_MODES.forEach(function (m) {
      var o = document.createElement("option");
      o.value = m;
      o.textContent = m;
      sel.appendChild(o);
    });
    if (current && REV_MODES.indexOf(current) !== -1) sel.value = current;
  }

  function setMsg(el, txt) {
    if (el) el.textContent = txt || "";
  }

  function renderDuePanel() {
    if (!dueOrderSelect) return;
    var date = dueSelectedDate();
    revBackDate = date;
    if (dueCustomWrap) dueCustomWrap.classList.toggle("hidden", !dueDateModeEl || dueDateModeEl.value !== "custom");
    if (dueCustomDate && !dueCustomDate.value) dueCustomDate.value = date;

    var paidMap = duePaidMap();
    var items = revTickets.filter(function (t) { return createdIso(t) === date; })
      .sort(function (a, b) { return String(a.t_name || "").localeCompare(String(b.t_name || "")); });
    var dueItems = items.filter(function (t) { return !t.failed && revInfo(t, paidMap).remaining > 0; });
    var openItems = items.filter(function (t) { return !t.failed; });

    var totalDue = 0, totalPaid = 0;
    items.filter(function (t) { return !t.failed; }).forEach(function (t) {
      var info = revInfo(t, paidMap);
      totalDue += info.due;
      totalPaid += info.paid;
    });
    var dueLeft = 0;
    dueItems.forEach(function (t) { dueLeft += revInfo(t, paidMap).remaining; });
    if (dueDateHint) {
      dueDateHint.textContent = "Order date " + dmy(date) + " \u2022 " + items.length + " order"
        + " \u2022 due bana " + money(totalDue) + " \u2022 due mila " + money(totalPaid)
        + " \u2022 baki " + money(dueLeft);
    }

    dueOrderSelect.innerHTML = "";
    if (!dueItems.length) {
      var oe = document.createElement("option");
      oe.value = "";
      oe.textContent = "Is date par koi due baki nahi";
      dueOrderSelect.appendChild(oe);
      dueOrderSelect.disabled = true;
      dueAmountInput.value = "";
      dueAmountInput.max = "";
      dueAcceptBtn.disabled = true;
      setMsg(dueAcceptMsg, "");
    } else {
      dueOrderSelect.disabled = false;
      dueItems.forEach(function (t, i) {
        var info = revInfo(t, paidMap);
        var o = document.createElement("option");
        o.value = t.id;
        o.textContent = (i + 1) + ". " + (t.t_name || "TICKET")
          + " \u2014 " + (t.src || "-") + "\u2192" + (t.dst || "-")
          + " \u2014 Due Rs " + num(info.remaining);
        dueOrderSelect.appendChild(o);
      });
      dueAcceptBtn.disabled = false;
    }
    syncDueAmount();

    fillModeSelect(dueModeSelect);
    fillModeSelect(failModeSelect);

    failTicketSelect.innerHTML = "";
    if (!openItems.length) {
      var fe = document.createElement("option");
      fe.value = "";
      fe.textContent = "Is date par koi ticket nahi";
      failTicketSelect.appendChild(fe);
      failTicketSelect.disabled = true;
      failBtn.disabled = true;
      if (failTicketInfo) failTicketInfo.textContent = "";
      failAmountInput.value = "";
      failAmountInput.max = "";
    } else {
      failTicketSelect.disabled = false;
      failBtn.disabled = false;
      openItems.forEach(function (t, i) {
        var info = revInfo(t, paidMap);
        var o = document.createElement("option");
        o.value = t.id;
        o.textContent = (i + 1) + ". " + (t.t_name || "TICKET")
          + " \u2014 Adv Rs " + num(info.adv) + " \u2022 Due Rs " + num(info.remaining);
        failTicketSelect.appendChild(o);
      });
    }
    syncFailTicket();

    // Failed list for this date
    if (failList) {
      failList.innerHTML = "";
      var used = items.filter(function (t) { return !!t.failed; });
      if (!used.length) {
        var none = document.createElement("div");
        none.className = "due-hint";
        none.textContent = "Is date ka koi ticket fail nahi hai.";
        failList.appendChild(none);
      } else {
        used.forEach(function (t) {
          var info = revInfo(t, paidMap);
          var row = document.createElement("div");
          row.className = "fail-row";
          var txt = document.createElement("span");
          txt.textContent = (t.t_name || "TICKET") + " \u2014 Return " + money(info.refund)
            + " \u2022 Due cancel " + money(Math.max(info.due - info.paid, 0));
          var undo = document.createElement("button");
          undo.type = "button";
          undo.className = "btn btn-ghost btn-sm";
          undo.textContent = "Undo Fail";
          undo.addEventListener("click", function () {
            undo.disabled = true;
            fetch("/api/tickets/" + t.id + "/unfail", {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
              body: "{}"
            })
              .then(function (r) { return r.json(); })
              .then(function (d) {
                if (!d.success) throw new Error(d.error || "Undo nahi hua.");
                toast("Fail undo ho gaya.", "ok");
                return loadRevenue();
              })
              .catch(function (err) { toast(err.message || "Undo nahi hua.", "err"); undo.disabled = false; });
          });
          row.appendChild(txt);
          row.appendChild(undo);
          failList.appendChild(row);
        });
      }
    }
  }

  function syncDueAmount() {
    var t = ticketBySelect(dueOrderSelect);
    if (!t) {
      dueAmountInput.value = "";
      dueAmountInput.max = "";
      dueAcceptBtn.disabled = true;
      return;
    }
    var info = revInfo(t, duePaidMap());
    dueAmountInput.value = info.remaining;
    dueAmountInput.max = info.remaining;
    dueAcceptBtn.disabled = false;
    setMsg(dueAcceptMsg, "Baki due " + money(info.remaining) + " \u2022 Advanced " + money(info.adv)
      + " \u2022 Total " + money(info.total));
  }

  function syncFailTicket() {
    var t = ticketBySelect(failTicketSelect);
    if (!t) {
      failAmountInput.value = "";
      failAmountInput.max = "";
      failBtn.disabled = true;
      if (failTicketInfo) failTicketInfo.textContent = "";
      return;
    }
    var info = revInfo(t, duePaidMap());
    var maxRefund = info.adv + info.rawPaid;
    failAmountInput.value = maxRefund;
    failAmountInput.max = maxRefund;
    failBtn.disabled = false;
    if (failTicketInfo) {
      failTicketInfo.textContent = "Advanced " + money(info.adv)
        + " \u2022 Due " + money(info.remaining)
        + " \u2022 Accepted due " + money(info.rawPaid)
        + " \u2022 Return " + money(maxRefund) + " tak";
    }
    if (failModeSelect) {
      var m = String(t.pay_mode || "").trim();
      if (REV_MODES.indexOf(m) !== -1) failModeSelect.value = m;
    }
  }

  function openDueModal() {
    if (!dueModal) return;
    if (dueDateModeEl && dueDateModeEl.value === "custom" && dueCustomDate && !dueCustomDate.value) {
      dueCustomDate.value = isoDaysAgo(1);
    }
    revBackDate = dueSelectedDate();
    dueModal.classList.remove("hidden");
    setMsg(dueAcceptMsg, "");
    setMsg(failMsg, "");
    renderDuePanel();
    renderRevenue();
    loadRevenue();
  }

  function closeDueModal() {
    if (dueModal) dueModal.classList.add("hidden");
  }

  if (revDateFilter) {
    revDateFilter.addEventListener("change", function () {
      revDateMode = revDateFilter.value;
      if (revCustomWrap) revCustomWrap.classList.toggle("hidden", revDateMode !== "custom");
      if (revDateMode === "custom" && revCustomDate && !revCustomDate.value) {
        revCustomDate.value = localIso(new Date());
      }
      renderRevenue();
    });
  }
  if (revCustomDate) {
    revCustomDate.addEventListener("change", function () {
      if (revCustomDate.value) revDateMode = "custom";
      renderRevenue();
    });
  }
  if (revRefreshBtn) revRefreshBtn.addEventListener("click", function () { loadRevenue(); });
  if (revDueBtn) revDueBtn.addEventListener("click", openDueModal);
  if (dueModalClose) dueModalClose.addEventListener("click", closeDueModal);
  if (dueModal) {
    dueModal.addEventListener("click", function (e) {
      if (e.target === dueModal) closeDueModal();
    });
  }

  if (dueDateModeEl) {
    dueDateModeEl.addEventListener("change", function () {
      if (dueDateModeEl.value === "custom" && dueCustomDate && !dueCustomDate.value) {
        dueCustomDate.value = isoDaysAgo(1);
      }
      revBackDate = dueSelectedDate();
      renderRevenue();
      renderDuePanel();
    });
  }
  if (dueCustomDate) {
    dueCustomDate.addEventListener("change", function () {
      revBackDate = dueSelectedDate();
      renderRevenue();
      renderDuePanel();
    });
  }
  if (dueOrderSelect) dueOrderSelect.addEventListener("change", syncDueAmount);
  if (failTicketSelect) failTicketSelect.addEventListener("change", syncFailTicket);

  if (dueAcceptBtn) {
    dueAcceptBtn.addEventListener("click", function () {
      var t = ticketBySelect(dueOrderSelect);
      if (!t) return;
      var amount = amt(dueAmountInput.value);
      var mode = dueModeSelect ? dueModeSelect.value : "";
      if (amount <= 0) { setMsg(dueAcceptMsg, "Amount 0 se zyada daalein."); return; }
      dueAcceptBtn.disabled = true;
      setMsg(dueAcceptMsg, "Accept ho raha hai...");
      fetch("/api/dues", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({
          ticket_id: t.id,
          amount: amount,
          pay_mode: mode,
          note: dueNoteInput ? dueNoteInput.value : ""
        })
      })
        .then(function (r) {
          return r.json().then(function (d) {
            if (!r.ok || !d.success) throw new Error(d.error || "Due accept nahi hua.");
            return d;
          });
        })
        .then(function (d) {
          toast(d.message || "Due accept ho gaya.", "ok");
          if (dueNoteInput) dueNoteInput.value = "";
          return loadRevenue();
        })
        .catch(function (err) {
          setMsg(dueAcceptMsg, err.message || "Due accept nahi hua.");
          toast(err.message || "Due accept nahi hua.", "err");
        })
        .finally(function () { dueAcceptBtn.disabled = false; });
    });
  }

  if (failBtn) {
    failBtn.addEventListener("click", function () {
      var t = ticketBySelect(failTicketSelect);
      if (!t) return;
      if (!confirm("Ticket '" + (t.t_name || "") + "' fail mark karein? Advanced/paid return + baki due cancel ho jayega.")) return;
      var amount = amt(failAmountInput.value);
      var mode = failModeSelect ? failModeSelect.value : "";
      failBtn.disabled = true;
      setMsg(failMsg, "Fail mark ho raha hai...");
      fetch("/api/tickets/" + t.id + "/fail", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({
          refund_amount: amount,
          pay_mode: mode,
          note: failNoteInput ? failNoteInput.value : ""
        })
      })
        .then(function (r) {
          return r.json().then(function (d) {
            if (!r.ok || !d.success) throw new Error(d.error || "Ticket fail nahi hua.");
            return d;
          });
        })
        .then(function (d) {
          toast(d.message || "Ticket fail mark hua.", "ok");
          if (failNoteInput) failNoteInput.value = "";
          return loadRevenue();
        })
        .catch(function (err) {
          setMsg(failMsg, err.message || "Ticket fail nahi hua.");
          toast(err.message || "Ticket fail nahi hua.", "err");
        })
        .finally(function () { failBtn.disabled = false; });
    });
  }

  if (revPdfBtn) {
    revPdfBtn.addEventListener("click", function () {
      var led = buildLedger(revMainDate());
      var hasAny = led.mainTot.orders > 0 || led.mainRows.length > 0
        || led.flowTot.due_mila > 0 || led.flowTot.ret > 0
        || led.backRows.length > 0 || led.fails.length > 0;
      if (!hasAny) { toast("Is filter me koi hisab nahi mila.", "err"); return; }
      revPdfBtn.disabled = true;
      revPdfBtn.textContent = "PDF ban raha hai...";
      fetch("/api/revenue/export", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({
          mode: revDateMode,
          date: revMainDate() || "",
          back_date: revBackDate || isoDaysAgo(1),
          label: revRangeLabel()
        })
      })
        .then(function (r) {
          if (!r.ok) return r.json().then(function (d) { throw new Error((d && d.error) || "PDF nahi bani."); });
          return r.blob();
        })
        .then(function (blob) {
          var url = URL.createObjectURL(blob);
          var a = document.createElement("a");
          a.href = url;
          a.download = "Revenue-" + revRangeLabel().replace(/[\\/:()]/g, "-") + ".pdf";
          document.body.appendChild(a);
          a.click();
          setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1200);
          toast("Revenue PDF download ho gayi.", "ok");
        })
        .catch(function (err) { toast(err.message || "PDF nahi bani.", "err"); })
        .finally(function () {
          revPdfBtn.disabled = false;
          revPdfBtn.textContent = "Download PDF";
        });
    });
  }
  if (revPrintBtn) revPrintBtn.addEventListener("click", function () { window.print(); });

  revBackDate = isoDaysAgo(1);
  if (initialTab === "revenue") loadRevenue();
  if (pdfList) loadPdfs();
})();