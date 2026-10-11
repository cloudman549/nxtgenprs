(function () {
  "use strict";

  var csrf = document.querySelector('meta[name="csrf-token"]').getAttribute("content");

  var srcInput = document.getElementById("srcInput");
  var dstInput = document.getElementById("dstInput");
  var srcBox = document.getElementById("srcBox");
  var dstBox = document.getElementById("dstBox");
  var trainInput = document.getElementById("trainInput");
  var trainBox = document.getElementById("trainBox");
  var swapBtn = document.getElementById("swapBtn");
  var findTrainBtn = document.getElementById("findTrainBtn");
  var dateInput = document.getElementById("dateInput");
  var clsInput = document.getElementById("clsInput");
  var quotaInput = document.getElementById("quotaInput");
  var payModeInput = document.getElementById("payModeInput");
  var altMobileInput = document.getElementById("altMobileInput");
  var payToggle = document.getElementById("payToggle");
  var advField = document.getElementById("advField");
  var descField = document.getElementById("descField");
  var advSection = document.getElementById("advSection");
  var orderDescInput = document.getElementById("orderDescInput");
  var advAmountInput = document.getElementById("advAmountInput");
  var rupeeSign = document.getElementById("rupeeSign");
  var totalAmountInput = document.getElementById("totalAmountInput");
  var totalRupeeSign = document.getElementById("totalRupeeSign");
  var dueAmount = document.getElementById("dueAmount");
  var boardingInput = document.getElementById("boardingInput");
  var trainTypeInput = document.getElementById("trainTypeInput");
  var mobileInput = document.getElementById("mobileInput");
  var ticketForm = document.getElementById("ticketForm");
  var ticketStatus = document.getElementById("ticketStatus");
  var saveBtn = document.getElementById("saveTicketBtn");
  var toastWrap = document.getElementById("toastWrap");

  var trainModal = document.getElementById("trainModal");
  var trainModalClose = document.getElementById("trainModalClose");
  var trainModalMsg = document.getElementById("trainModalMsg");
  var trainTableBody = document.querySelector("#trainTable tbody");
  var trainSel = document.getElementById("trainSel");
  var trainSelInfo = document.getElementById("trainSelInfo");
  var trainSelSelect = document.getElementById("trainSelSelect");
  var trainSelCancel = document.getElementById("trainSelCancel");
  var currentPick = null;

  function toast(msg, type) {
    var el = document.createElement("div");
    el.className = "toast toast-" + (type || "info");
    el.textContent = msg;
    toastWrap.appendChild(el);
    setTimeout(function () { el.remove(); }, 4500);
  }

  function showStatus(msg, isError) {
    ticketStatus.textContent = msg;
    ticketStatus.className = "status " + (isError ? "status-err" : "status-ok");
    ticketStatus.classList.remove("hidden");
  }

  // ---------------- Default journey date = tomorrow ----------------
  (function () {
    var d = new Date();
    d.setDate(d.getDate() + 1);
    var iso = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    dateInput.value = iso;
  })();

  // ---------------- Passenger rows ----------------
  var sexOpts = ["M", "F", "T"];
  var berthOpts = ["LB", "MB", "UB", "SL", "SU"];

  function opts(list) {
    return list.map(function (v) {
      return '<option value="' + v + '">' + (v || "-") + "</option>";
    }).join("");
  }

  function maxRowsForQuota() {
    return (quotaInput.value === "TQ" || quotaInput.value === "PT") ? 4 : 6;
  }

  function addPassengerRow(body, i) {
    var tr = document.createElement("tr");
    tr.innerHTML =
      '<td class="pass-no">' + i + "</td>" +
      '<td><input type="text" class="p-name" placeholder="Name" autocapitalize="characters" autocorrect="off"></td>' +
      '<td><input type="text" class="p-age" maxlength="3" placeholder="Age"></td>' +
      '<td><select class="p-gender">' + opts(sexOpts) + "</select></td>" +
      '<td><select class="p-berth">' + opts(berthOpts) + "</select></td>";
    body.appendChild(tr);
  }

  function renumberRows() {
    var rows = document.querySelectorAll("#passengerBody tr");
    rows.forEach(function (tr, idx) {
      tr.querySelector(".pass-no").textContent = idx + 1;
    });
  }

  function syncPassengerRows() {
    var body = document.getElementById("passengerBody");
    var rows = body.querySelectorAll("tr");
    var max = maxRowsForQuota();
    var filled = rows.length;
    for (var i = rows.length - 1; i >= max; i--) {
      var tr = rows[i];
      var empty = !tr.querySelector(".p-name").value.trim() && !tr.querySelector(".p-age").value.trim();
      if (empty) { tr.remove(); filled--; } else { break; }
    }
    for (var n = filled + 1; n <= max; n++) addPassengerRow(body, n);
    renumberRows();
  }

  function buildPassengers() {
    var body = document.getElementById("passengerBody");
    body.innerHTML = "";
    for (var i = 1; i <= maxRowsForQuota(); i++) addPassengerRow(body, i);
  }

  quotaInput.addEventListener("change", syncPassengerRows);

  var modalQuotaBtns = document.getElementById("modalQuotaBtns");
  var modalDateInput = document.getElementById("modalDateInput");
  function syncModalQuota() {
    modalQuotaBtns.querySelectorAll(".quota-btn").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-val") === quotaInput.value);
    });
  }
  modalQuotaBtns.addEventListener("click", function (e) {
    var b = e.target.closest(".quota-btn");
    if (!b) return;
    quotaInput.value = b.getAttribute("data-val");
    syncModalQuota();
    syncPassengerRows();
  });
  modalDateInput.addEventListener("change", function () {
    dateInput.value = modalDateInput.value;
  });
  dateInput.addEventListener("change", function () {
    if (modalDateInput) modalDateInput.value = dateInput.value;
  });
  quotaInput.addEventListener("change", syncModalQuota);
  syncModalQuota();

  function fmtTrain(num, name) {
    return name ? (num + "-" + name).toUpperCase() : num;
  }

  buildPassengers();

  // ---------------- Edit mode ----------------
  var editId = new URLSearchParams(window.location.search).get("edit") || "";
  if (editId) {
    fetch("/api/tickets/" + encodeURIComponent(editId), { headers: { "X-CSRF-Token": csrf } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.success || !data.ticket) {
          toast((data && data.error) || "Ticket nahi mili.", "err");
          return;
        }
        fillForm(data.ticket);
      })
      .catch(function () { toast("Network error.", "err"); });
  }

  function fillForm(t) {
    var head = document.querySelector(".page-head h1");
    if (head) head.textContent = "Edit " + head.textContent;
    if (t.src) srcInput.value = t.src;
    if (t.dst) dstInput.value = t.dst;
    if (t.date) dateInput.value = t.date;
    if (t.train) trainInput.value = t.train.toUpperCase();
    if (t.boarding) boardingInput.value = t.boarding;
    if (t.cls) setClass(t.cls);
    if (t.quota) quotaInput.value = t.quota;
    if (t.train_type) trainTypeInput.value = t.train_type;
    if (t.mobile) mobileInput.value = t.mobile;
    if (t.alt_mobile) altMobileInput.value = t.alt_mobile;
    if (t.desc) orderDescInput.value = t.desc;
    if (t.total) totalAmountInput.value = String(t.total).replace(/\D/g, "");
    if (t.pay === "Advanced" && t.adv_amount) advAmountInput.value = String(t.adv_amount).replace(/\D/g, "");
    totalRupeeSign.classList.toggle("hidden", totalAmountInput.value === "");
    rupeeSign.classList.toggle("hidden", advAmountInput.value === "");

    var paid = t.pay === "Advanced";
    payToggle.querySelectorAll(".pay-opt").forEach(function (o) {
      o.classList.toggle("active", o.getAttribute("data-val") === t.pay);
    });
    if (advSection) advSection.classList.toggle("hidden", !paid);
    advField.classList.toggle("hidden", !paid);
    descField.classList.toggle("hidden", !paid);

    if (starToggle && t.starred) {
      starToggle.classList.add("active");
      starToggle.innerHTML = "&#9733; Star";
    }

    buildPassengers();
    var body = document.getElementById("passengerBody");
    var rows = body.querySelectorAll("tr");
    var gmap = { M: "M", F: "F", T: "T", Male: "M", Female: "F", Transgender: "T" };
    var bmap = { LB: "LB", MB: "MB", UB: "UB", SL: "SL", SU: "SU", Lower: "LB", Middle: "MB", Upper: "UB", "Side Lower": "SL", "Side Upper": "SU" };
    (t.passengers || []).forEach(function (p, i) {
      var tr = rows[i];
      if (!tr) return;
      tr.querySelector(".p-name").value = p.name || "";
      tr.querySelector(".p-age").value = p.age || "";
      tr.querySelector(".p-gender").value = gmap[p.gender] || (sexOpts.indexOf(p.gender) !== -1 ? p.gender : "M");
      tr.querySelector(".p-berth").value = bmap[p.berth] || p.berth || "LB";
    });

    if (t.avail_info && t.avail_info.fare && t.avail_info.status) {
      lastAvail = t.avail_info;
      renderFormAvail();
    }

    if (t.t_name) ticketForm.setAttribute("data-ticket-name", t.t_name);
    computeDue();
    saveBtn.textContent = "Update Ticket";
    ticketForm.setAttribute("data-edit-id", editId);
  }

  // ---------------- Autocomplete ----------------
  function attachAutocomplete(input, box, url, pick) {
    var timer = null;
    input.addEventListener("input", function () {
      var q = input.value.trim();
      clearTimeout(timer);
      if (!q) { box.classList.add("hidden"); return; }
      timer = setTimeout(function () {
        fetch(url + encodeURIComponent(q), { headers: { "X-CSRF-Token": csrf } })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!data.success || !data.items || !data.items.length) {
              box.classList.add("hidden");
              return;
            }
            box.innerHTML = "";
            data.items.forEach(function (item) {
              var div = document.createElement("div");
              div.className = "autocomplete-item";
              div.textContent = item;
              div.addEventListener("mousedown", function (e) {
                e.preventDefault();
                pick(item);
                box.classList.add("hidden");
              });
              box.appendChild(div);
            });
            box.classList.remove("hidden");
          })
          .catch(function () { box.classList.add("hidden"); });
      }, 200);
    });
    input.addEventListener("blur", function () {
      setTimeout(function () { box.classList.add("hidden"); }, 150);
    });
  }

  attachAutocomplete(srcInput, srcBox, "/api/stations?q=", function (item) {
    srcInput.value = item;
    autoTicketName();
  });
  attachAutocomplete(dstInput, dstBox, "/api/stations?q=", function (item) {
    dstInput.value = item;
    autoTicketName();
  });
  attachAutocomplete(trainInput, trainBox, "/api/trains?q=", function (item) {
    trainInput.value = item.replace(/\s*-\s*/, "-");
  });

  swapBtn.addEventListener("click", function () {
    var a = srcInput.value;
    srcInput.value = dstInput.value;
    dstInput.value = a;
    autoTicketName();
  });

  function firstPaxName() {
    var el = document.querySelector("#passengerBody .p-name");
    var v = el ? el.value.trim() : "";
    return v.split(" ")[0] || "";
  }

  function codeOf(value) {
    if (!value) return "";
    return value.indexOf(" - ") !== -1 ? value.split(" - ").pop().trim() : value.trim();
  }

  function autoTicketName() {
    var parts = [codeOf(srcInput.value).toUpperCase(), codeOf(dstInput.value).toUpperCase(), firstPaxName().toUpperCase()];
    var name = parts.filter(Boolean).join("-");
    ticketForm.setAttribute("data-ticket-name", name);
  }

  srcInput.addEventListener("blur", autoTicketName);
  dstInput.addEventListener("blur", autoTicketName);
  document.addEventListener("input", function (e) {
    if (e.target && e.target.classList.contains("p-name")) {
      e.target.value = e.target.value.toUpperCase();
      autoTicketName();
    }
  });
  autoTicketName();

  // ---------------- Train search ----------------
  findTrainBtn.addEventListener("click", function () {
    var from = srcInput.value.trim();
    var to = dstInput.value.trim();
    if (!from || !to) { toast("From aur To daalein.", "err"); return; }
    if (modalDateInput) { modalDateInput.value = dateInput.value; syncModalQuota(); }
    trainModal.classList.remove("hidden");
    trainModalMsg.textContent = "Loading trains...";
    trainTableBody.innerHTML = "";
    var params = "?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to) +
      "&date=" + encodeURIComponent(dateInput.value || "");
    fetch("/api/train-search" + params, { headers: { "X-CSRF-Token": csrf } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.success) { trainModalMsg.textContent = data.error || "Train list nahi mili."; return; }
        var trains = data.trains || [];
        trainModalMsg.textContent = trains.length + " trains mili.";
        var days = ["M", "T", "W", "Th", "F", "S", "Su"];
        trains.forEach(function (t) {
          var tr = document.createElement("tr");
          var dayCells = t.days.split("").map(function (d, i) {
            return '<td class="' + (d === "1" ? "day-y" : "day-n") + '">' + days[i] + "</td>";
          }).join("");
          tr.innerHTML =
            "<td>" + esc(t.num) + "</td>" +
            '<td class="train-name-cell">' + esc(t.name) + "</td>" +
            "<td>" + esc(t.from) + "</td>" +
            "<td>" + esc(t.depart) + "</td>" +
            "<td>" + esc(t.to) + "</td>" +
            "<td>" + esc(t.arrive) + "</td>" +
            "<td>" + esc(t.duration) + "</td>" +
            dayCells +
            '<td class="train-classes"></td>';

          var cell = tr.querySelector(".train-classes");
          var classes = t.classes || [];
          if (classes.length) {
            classes.forEach(function (c) {
              var chip = document.createElement("button");
              chip.type = "button";
              chip.className = "class-chip";
              chip.textContent = c;
              chip.addEventListener("click", function (e) {
                e.stopPropagation();
                pickClass(t, c, chip);
              });
              cell.appendChild(chip);
            });
          } else {
            cell.textContent = "-";
          }

          tr.addEventListener("click", function () { selectTrain(t, ""); });
          trainTableBody.appendChild(tr);
        });
      })
      .catch(function () { trainModalMsg.textContent = "Network error."; });
  });

  function setClass(cls) {
    var found = false;
    for (var i = 0; i < clsInput.options.length; i++) {
      if (clsInput.options[i].value === cls) { found = true; break; }
    }
    if (!found) {
      var o = document.createElement("option");
      o.value = cls;
      o.textContent = cls;
      clsInput.appendChild(o);
    }
    clsInput.value = cls;
  }

  function clearPick() {
    currentPick = null;
    trainSel.classList.add("hidden");
    document.querySelectorAll(".class-chip.chip-picked").forEach(function (c) {
      c.classList.remove("chip-picked");
    });
  }

  var lastAvail = null;
  var formAvailInfo = document.getElementById("formAvailInfo");

  function renderFormAvail() {
    if (!formAvailInfo) return;
    if (lastAvail && lastAvail.status && lastAvail.fare) {
      formAvailInfo.innerHTML =
        "Fare: <b>&#8377;" + esc(lastAvail.fare) + "</b> &middot; Availability: <b>" + esc(lastAvail.status) + "</b>";
      formAvailInfo.className = "form-avail " +
        (/^AVAILABLE/i.test(lastAvail.status) || /\bCNF\b/i.test(lastAvail.status) ? "avail-ok" : "avail-no");
    } else {
      formAvailInfo.className = "form-avail hidden";
    }
  }

  function pickClass(t, c, chip) {
    clearPick();
    currentPick = { t: t, cls: c };
    chip.classList.add("chip-picked");
    trainModalMsg.textContent = "Fare aur availability check ho rahi hai...";
    var from = codeOf(srcInput.value) || t.from;
    var to = codeOf(dstInput.value) || t.to;
    var params =
      "?train=" + encodeURIComponent(t.num) +
      "&name=" + encodeURIComponent(t.name || "") +
      "&from=" + encodeURIComponent(from) +
      "&to=" + encodeURIComponent(to) +
      "&cls=" + encodeURIComponent(c) +
      "&quota=" + encodeURIComponent(quotaInput.value) +
      "&date=" + encodeURIComponent(dateInput.value || "");
    // Timeout protection for Vercel serverless
    var timeoutId = setTimeout(function () {
      if (!currentPick) return;
      clearPick();
      trainModalMsg.textContent = "Fare availability fetch timeout. Try again.";
      trainSel.classList.remove("hidden");
      trainSelInfo.innerHTML = "<span class='err-text'>Availability check timeout. Manual entry available.</span>";
      trainSelInfo.className = "train-sel-info avail-no";
    }, 12000); // 12 second timeout

    fetch("/api/train-avail" + params, {
      headers: { "X-CSRF-Token": csrf },
      signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined // 10s timeout
    })
      .then(function (r) {
        clearTimeout(timeoutId);
        return r.json();
      })
      .then(function (data) {
        if (!currentPick) return;
        var status = data.success ? (data.status || "Not Available") : "-";
        var fare = data.success ? (data.fare || "-") : "-";
        if (data.success) {
          lastAvail = { train: t.num, cls: c, quota: quotaInput.value, fare: fare, status: status, date: dateInput.value || "" };
          renderFormAvail();
        }
        trainSelInfo.innerHTML =
          "Train " + esc(t.num) + " &middot; " + esc(t.name) + " &middot; " +
          "Class " + esc(c) + " &middot; Quota " + esc(quotaInput.value) + "<br>" +
          "Fare: <b class='avail-val'>&#8377;" + esc(fare) + "</b> &middot; Availability: <b class='avail-val'>" + esc(status) + "</b>";
        var isAvail = /^AVAILABLE/i.test(status) || /\bCNF\b/i.test(status);
        trainSelInfo.className = "train-sel-info " + (isAvail ? "avail-ok" : "avail-no");
        if (!data.success && data.error) {
          trainSelInfo.innerHTML = "<span class='err-text'>" + esc(data.error) + "</span>";
          trainSelInfo.className = "train-sel-info avail-no";
          lastAvail = null;
          renderFormAvail();
        }
        trainModalMsg.textContent = "";
        trainSel.classList.remove("hidden");
      })
      .catch(function (err) {
        clearTimeout(timeoutId);
        if (!currentPick) return;
        clearPick();
        var errMsg = err && err.name === "AbortError" ? "Request timeout. Try again." : "Fare/availability lete waqt error aaya.";
        trainModalMsg.textContent = errMsg;
        trainSelInfo.innerHTML = "<span class='err-text'>" + errMsg + "</span>";
        trainSelInfo.className = "train-sel-info avail-no";
      });
  }

  trainSelSelect.addEventListener("click", function () {
    if (!currentPick) return;
    var t = currentPick.t;
    var c = currentPick.cls;
    clearPick();
    selectTrain(t, c);
  });

  trainSelCancel.addEventListener("click", clearPick);

  function selectTrain(t, cls) {
    trainInput.value = fmtTrain(t.num, t.name);
    if (t.from) srcInput.value = t.from;
    if (t.to) dstInput.value = t.to;
    if (cls) setClass(cls);
    autoTicketName();
    trainModal.classList.add("hidden");
    toast("Train " + t.num + (cls ? " (" + cls + ")" : "") + " select ho gayi.", "ok");
  }

  trainModalClose.addEventListener("click", function () { trainModal.classList.add("hidden"); });
  trainModal.addEventListener("click", function (e) {
    if (e.target === trainModal) trainModal.classList.add("hidden");
  });

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ---------------- Mobile ----------------
  mobileInput.addEventListener("input", function () {
    mobileInput.value = mobileInput.value.replace(/\D/g, "").slice(0, 10);
  });
  altMobileInput.addEventListener("input", function () {
    altMobileInput.value = altMobileInput.value.replace(/\D/g, "").slice(0, 10);
  });

  // ---------------- Paid / Unpaid toggle ----------------
  function payValue() {
    var active = payToggle.querySelector(".pay-opt.active");
    return active ? (active.getAttribute("data-val") || "") : "";
  }

  payToggle.addEventListener("click", function (e) {
    var opt = e.target.closest(".pay-opt");
    if (!opt) return;
    payToggle.querySelectorAll(".pay-opt").forEach(function (o) { o.classList.remove("active"); });
    opt.classList.add("active");
    var paid = payValue() === "Advanced";
    if (advSection) advSection.classList.toggle("hidden", !paid);
    advField.classList.toggle("hidden", !paid);
    descField.classList.toggle("hidden", !paid);
    computeDue();
  });

  // ---------------- Star toggle ----------------
  var starToggle = document.getElementById("starToggle");
  if (starToggle) {
    starToggle.addEventListener("click", function () {
      var on = starToggle.classList.toggle("active");
      starToggle.innerHTML = on ? "&#9733; Star" : "&#9734; Star";
      toast(on ? "Star lag gaya." : "Star hata diya.", on ? "ok" : "");
    });
  }

  function computeDue() {
    var total = parseInt(totalAmountInput.value.replace(/\D/g, ""), 10) || 0;
    var adv = payValue() === "Advanced" ? (parseInt(advAmountInput.value.replace(/\D/g, ""), 10) || 0) : 0;
    var due = Math.max(0, total - adv);
    dueAmount.textContent = due === 0 && total === 0 ? "0" : String(due);
  }

  totalAmountInput.addEventListener("input", function () {
    totalAmountInput.value = totalAmountInput.value.replace(/\D/g, "").slice(0, 7);
    totalRupeeSign.classList.toggle("hidden", totalAmountInput.value === "");
    computeDue();
  });

  advAmountInput.addEventListener("input", function () {
    advAmountInput.value = advAmountInput.value.replace(/\D/g, "").slice(0, 6);
    rupeeSign.classList.toggle("hidden", advAmountInput.value === "");
    computeDue();
  });

  computeDue();

  // ---------------- Submit ----------------
  function collectPassengers() {
    var out = [];
    document.querySelectorAll("#passengerBody tr").forEach(function (tr) {
      var name = tr.querySelector(".p-name").value.trim().toUpperCase();
      if (!name) return;
      out.push({
        name: name,
        age: tr.querySelector(".p-age").value.trim(),
        gender: tr.querySelector(".p-gender").value,
        berth: tr.querySelector(".p-berth").value
      });
    });
    return out;
  }

  function resetForm() {
    srcInput.value = "";
    dstInput.value = "";
    trainInput.value = "";
    boardingInput.value = "";
    mobileInput.value = "";
    altMobileInput.value = "";
    totalAmountInput.value = "";
    advAmountInput.value = "";
    orderDescInput.value = "";
    dueAmount.textContent = "0";
    totalRupeeSign.classList.add("hidden");
    rupeeSign.classList.add("hidden");
    quotaInput.value = "GN";
    setClass("SL");
    trainTypeInput.value = "";
    var d = new Date();
    d.setDate(d.getDate() + 1);
    dateInput.value = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    payToggle.querySelectorAll(".pay-opt").forEach(function (o) {
      o.classList.toggle("active", o.getAttribute("data-val") === "Advanced");
    });
    if (advSection) advSection.classList.remove("hidden");
    advField.classList.remove("hidden");
    descField.classList.remove("hidden");
    if (starToggle) {
      starToggle.classList.remove("active");
      starToggle.innerHTML = "&#9734; Star";
    }
    lastAvail = null;
    renderFormAvail();
    buildPassengers();
    ticketForm.setAttribute("data-ticket-name", "");
    ticketForm.removeAttribute("data-edit-id");
    autoTicketName();
    computeDue();
  }

  ticketForm.addEventListener("submit", function (e) {
    e.preventDefault();
    autoTicketName();
    var payload = {
      t_name: ticketForm.getAttribute("data-ticket-name") || "",
      src: srcInput.value.trim(),
      dst: dstInput.value.trim(),
      train: trainInput.value.trim(),
      cls: clsInput.value,
      date: dateInput.value,
      boarding: boardingInput.value.trim(),
      quota: quotaInput.value,
      train_type: trainTypeInput.value,
      mobile: mobileInput.value.trim(),
      alt_mobile: altMobileInput.value.trim(),
      pay: payValue(),
      pay_mode: payModeInput ? payModeInput.value : "",
      total: totalAmountInput.value.trim(),
      adv_amount: (payValue() === "Advanced" ? advAmountInput.value.trim() : ""),
      desc: orderDescInput.value.trim(),
      passengers: collectPassengers(),
      starred: starToggle ? starToggle.classList.contains("active") : false,
      avail: lastAvail
    };
    if (!payload.t_name || !payload.train) {
      showStatus("Target Name aur Train No. daalna zaroori hai.", true);
      return;
    }
    if (payload.mobile.length !== 10) {
      showStatus("Mobile number 10 digits ka hona chahiye.", true);
      return;
    }
    var complete = payload.passengers.filter(function (p) {
      return p.name && p.age && p.gender;
    });
    if (!complete.length) {
      showStatus("Minimum ek passenger ka Name, Age aur Gender bharo.", true);
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
    var editing = ticketForm.getAttribute("data-edit-id");
    fetch(editing ? "/api/tickets/" + encodeURIComponent(editing) : "/api/tickets", {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) {
          if (editing) {
            showStatus(data.message || "Ticket update ho gayi.", false);
            toast(data.message || "Ticket update ho gayi.", "ok");
            setTimeout(function () { location.href = "/ticket/new"; }, 1500);
          } else {
            showStatus(data.message || "Ticket save ho gayi.", false);
            toast(data.message || "Ticket save ho gayi.", "ok");
            resetForm();
          }
        } else {
          showStatus(data.error || "Ticket save nahi ho saki.", true);
        }
      })
      .catch(function () { showStatus("Network error.", true); })
      .finally(function () {
        saveBtn.disabled = false;
        saveBtn.textContent = editing ? "Update Ticket" : "Save Ticket";
      });
  });
})();
