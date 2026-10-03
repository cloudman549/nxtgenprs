(function () {
  "use strict";

  var csrf = document.querySelector('meta[name="csrf-token"]').getAttribute("content");

  var toastWrap = document.getElementById("toastWrap");

  function toast(msg, type) {
    var el = document.createElement("div");
    el.className = "toast toast-" + (type || "info");
    el.textContent = msg;
    toastWrap.appendChild(el);
    setTimeout(function () { el.remove(); }, 4500);
  }

  // ---- Employee management (sirf admin se account banta hai) ----
  var empList = document.getElementById("empList");
  var empToggleBtn = document.getElementById("empToggleBtn");
  var createEmpForm = document.getElementById("createEmpForm");
  var createEmpBtn = document.getElementById("createEmpBtn");
  var empOpened = false;

  function toggleEmployees() {
    empList.classList.toggle("hidden");
    empToggleBtn.textContent = empList.classList.contains("hidden") ? "View Employees" : "Hide Employees";
    if (!empOpened) { empOpened = true; loadEmployees(); }
  }
  if (empToggleBtn) empToggleBtn.addEventListener("click", toggleEmployees);

  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function empCardTpl(u) {
    var photo = u.emp.photo || "";
    var front =
      '<div class="emp-card-top">' +
      '<span class="emp-card-brand">NXTGen PRS</span>' +
      '<span class="emp-card-type">EMPLOYEE ID CARD</span>' +
      "</div>" +
      '<div class="emp-card-accent"></div>' +
      '<div class="emp-card-body">' +
      '<div class="emp-photo-wrap">' +
      '<img class="emp-card-photo" src="' + escHtml(photo) + '" alt="' + escHtml(u.emp.full_name || u.username) + '">' +
      '<span class="emp-photo-ph">PHOTO</span>' +
      "</div>" +
      '<div class="emp-card-info">' +
      '<div class="emp-card-name">' + escHtml(u.emp.full_name || u.username) + "</div>" +
      '<div class="emp-card-dept">' + escHtml(u.emp.department || "-") + "</div>" +
      '<div class="emp-card-grid">' +
      "<div><span>Employee ID</span><b>" + escHtml(u.username) + "</b></div>" +
      "<div><span>Aadhar No.</span><b>" + escHtml(u.emp.aadhar || "-") + "</b></div>" +
      "<div><span>Joining Date</span><b>" + escHtml(u.emp.joining_date || "-") + "</b></div>" +
      "<div><span>Age</span><b>" + escHtml(u.emp.age || "-") + "</b></div>" +
      "<div><span>Experience</span><b>" + escHtml(u.emp.work_exp || "-") + "</b></div>" +
      "<div><span>Validity</span><b>Permanent</b></div>" +
      "</div>" +
      "</div>" +
      "</div>" +
      '<div class="emp-card-foot"><span>Authorized Signature \u2014 Admin</span><span>' + escHtml(u.username) + "</span></div>";
    var back =
      '<div class="emp-card-top">' +
      '<span class="emp-card-brand">NXTGen PRS</span>' +
      '<span class="emp-card-type">EMPLOYEE ID CARD</span>' +
      "</div>" +
      '<div class="emp-card-accent"></div>' +
      '<div class="emp-card-back-body">' +
      '<div class="emp-card-back-label">FULL ADDRESS</div>' +
      '<div class="emp-card-back-addr">' + escHtml(u.emp.address || "-") + "</div>" +
      "</div>" +
      '<div class="emp-card-back-foot"><span>OFFICIAL USE ONLY</span><span>' + escHtml(u.username) + "</span></div>";
    return (
      '<div class="emp-card-flip" tabindex="0" title="Address ke liye card pe click karo">' +
      '<div class="emp-card emp-card-front">' + front + "</div>" +
      '<div class="emp-card emp-card-back">' + back + "</div>" +
      "</div>"
    );
  }

  function renderEmployees(emps) {
    empList.innerHTML = "";
    if (!emps || !emps.length) {
      var e = document.createElement("div");
      e.className = "empty";
      e.textContent = "Abhi koi employee nahi hai.";
      empList.appendChild(e);
      return;
    }
    emps.forEach(function (u) {
      var wrap = document.createElement("div");
      wrap.className = "emp-card-wrap";
      wrap.innerHTML = empCardTpl(u) +
        '<div class="emp-actions">' +
        '<button type="button" class="btn btn-primary btn-sm" data-act="card" title="ID card PDF download">Card PDF</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="pass" title="Password change karo">Password</button>' +
        '<button type="button" class="btn btn-danger btn-sm" data-act="del" title="Account delete karo">Delete</button>' +
        "</div>";
      var img = wrap.querySelector(".emp-card-photo");
      var ph = wrap.querySelector(".emp-photo-ph");
      if (!u.emp.photo) { img.style.display = "none"; ph.style.display = "flex"; }
      img.addEventListener("error", function () { img.style.display = "none"; ph.style.display = "flex"; });
      var flip = wrap.querySelector(".emp-card-flip");
      if (flip) {
        flip.addEventListener("click", function () { flip.classList.toggle("flipped"); });
        flip.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip.classList.toggle("flipped"); }
        });
      }
      wrap.querySelector('[data-act="card"]').addEventListener("click", function () {
        window.open("/admin/api/employees/" + u._id + "/card", "_blank");
      });
      wrap.querySelector('[data-act="pass"]').addEventListener("click", function () {
        var pw = window.prompt("Naya password (min 4 characters):", "");
        if (!pw) return;
        fetch("/admin/api/employees/" + u._id + "/password", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body: JSON.stringify({ password: pw })
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.success) toast(data.message || "Password change ho gaya.", "ok");
            else toast(data.error || "Change nahi hua.", "err");
          })
          .catch(function () { toast("Network error.", "err"); });
      });
      wrap.querySelector('[data-act="del"]').addEventListener("click", function () {
        if (!confirm("Employee '" + (u.emp.full_name || u.username) + "' aur uska account delete karna hai?")) return;
        fetch("/admin/api/users/" + u._id, { method: "DELETE", headers: { "X-CSRF-Token": csrf } })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.success) { toast(data.message || "Employee deleted.", "ok"); loadEmployees(); }
            else toast(data.error || "Delete failed.", "err");
          })
          .catch(function () { toast("Network error.", "err"); });
      });
      empList.appendChild(wrap);
    });
  }

  function loadEmployees() {
    fetch("/admin/api/employees", { headers: { "X-CSRF-Token": csrf } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) renderEmployees(data.employees || []);
        else { empList.innerHTML = ""; var e = document.createElement("div"); e.className = "empty"; e.textContent = data.error || "Employees load nahi hue."; empList.appendChild(e); }
      })
      .catch(function () {
        empList.innerHTML = "";
        var e = document.createElement("div");
        e.className = "empty";
        e.textContent = "Network error. Employees load nahi hue.";
        empList.appendChild(e);
      });
  }

  if (createEmpForm) {
    createEmpForm.addEventListener("submit", function (e) {
      e.preventDefault();
      createEmpBtn.disabled = true;
      var body = new FormData(createEmpForm);
      fetch("/admin/api/employees", { method: "POST", headers: { "X-CSRF-Token": csrf }, body: body })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.success) {
            toast(data.message || "Employee ban gaya.", "ok");
            createEmpForm.reset();
            loadEmployees();
          } else {
            toast(data.error || "Employee create nahi hua.", "err");
          }
        })
        .catch(function () { toast("Network error. Employee create nahi hua.", "err"); })
        .finally(function () { createEmpBtn.disabled = false; });
    });
  }
})();