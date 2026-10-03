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
    pdfList.innerHTML = "";
    if (!items.length) {
      var empty = document.createElement("div");
      empty.className = "empty";
      if (allPdfs.length && dateFilter.value === "today") {
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
  }
  dashTabs.forEach(function (t) {
    t.addEventListener("click", function () { showTab(t.getAttribute("data-tab")); });
  });

  var initialTab = new URLSearchParams(window.location.search).get("tab");
  if (initialTab && (initialTab === "fresh" || initialTab === "pdfs" || initialTab === "order")) {
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
    if (td === jd) return true;
    return t.starred && td === nextDayIso(jd);
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
    grid4.appendChild(formField("Due", dueOf(t)));
    grid4.appendChild(formField("Description", t.desc));
    body.appendChild(grid4);

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
    row.className = "order-row" + (t.booked ? " booked" : "") + (t.starred ? " starred" : "");

    var head = document.createElement("div");
    head.className = "order-head";

    var main = document.createElement("div");
    main.className = "order-main";
    var title = document.createElement("div");
    title.className = "order-title";
    title.textContent = (t.starred ? "\u2605 " : "") + "CARD-" + num + "-" + (t.t_name || "TICKET");
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

  if (pdfList) loadPdfs();
})();