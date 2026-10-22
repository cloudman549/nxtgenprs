(function () {
  "use strict";

  var csrf = document.querySelector('meta[name="csrf-token"]').getAttribute("content");
  var area = document.getElementById("notepadContent");
  var statusEl = document.getElementById("notepadStatus");
  var saveBtn = document.getElementById("notepadSaveBtn");
  var listEl = document.getElementById("notepadList");
  var countEl = document.getElementById("notepadCount");
  var toastWrap = document.getElementById("toastWrap");
  var meId = "";

  function toast(msg, type) {
    var el = document.createElement("div");
    el.className = "toast toast-" + (type || "info");
    el.textContent = msg;
    toastWrap.appendChild(el);
    setTimeout(function () { el.remove(); }, 3000);
  }

  function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function fmtTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var now = new Date();
    var hm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    if (d.toDateString() === now.toDateString()) return hm;
    var dd = String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0");
    return dd + " " + hm;
  }

  function noteEl(n) {
    var wrap = document.createElement("div");
    wrap.className = "note-item";
    wrap.setAttribute("data-id", n.id);

    var head = document.createElement("div");
    head.className = "note-head";
    var who = document.createElement("span");
    who.className = "note-author";
    who.textContent = n.author || "?";
    var time = document.createElement("span");
    time.className = "note-time";
    time.textContent = fmtTime(n.created_at) + (n.edited ? " \u00b7 edited" : "");
    var actions = document.createElement("div");
    actions.className = "note-actions";
    var edit = document.createElement("button");
    edit.type = "button"; edit.className = "note-btn"; edit.textContent = "Edit";
    var del = document.createElement("button");
    del.type = "button"; del.className = "note-btn note-del"; del.textContent = "Delete";
    actions.appendChild(edit);
    actions.appendChild(del);
    head.appendChild(who);
    head.appendChild(time);
    head.appendChild(actions);

    var body = document.createElement("div");
    body.className = "note-text";
    body.textContent = n.text || "";

    wrap.appendChild(head);
    wrap.appendChild(body);

    edit.addEventListener("click", function () { startEdit(wrap, n); });
    del.addEventListener("click", function () { delNote(wrap, n); });
    return wrap;
  }

  function updateCount() {
    var c = listEl.querySelectorAll(".note-item").length;
    if (countEl) countEl.textContent = c + " note" + (c === 1 ? "" : "s");
  }

  function render(notes) {
    listEl.innerHTML = "";
    if (!notes.length) {
      var empty = document.createElement("div");
      empty.className = "note-empty muted";
      empty.textContent = "Abhi koi note nahi. Pehla note tum likho!";
      listEl.appendChild(empty);
    } else {
      notes.forEach(function (n) { listEl.appendChild(noteEl(n)); });
    }
    updateCount();
  }

  function load() {
    return fetch("/api/notepad", { headers: { "X-CSRF-Token": csrf } })
      .then(function (r) {
        if (r.status === 401) return { success: false, login_required: true };
        return r.json();
      })
      .then(function (d) {
        if (d && d.success) {
          meId = d.me_id || "";
          render(d.notes || []);
          setStatus("Loaded");
        } else if (d && d.login_required) {
          setStatus("Team notes dekhne ke liye login karo.");
          listEl.innerHTML = "";
        } else {
          setStatus("Load nahi hua.");
        }
      })
      .catch(function () { setStatus("Network error."); });
  }

  function post() {
    var text = (area.value || "").trim();
    if (!text) { setStatus("Kuch likho."); return; }
    setStatus("Posting...");
    fetch("/api/notepad", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ text: text })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.success && d.note) {
          area.value = "";
          var empty = listEl.querySelector(".note-empty");
          if (empty) empty.remove();
          listEl.appendChild(noteEl(d.note));
          updateCount();
          setStatus("Posted");
          toast("Note post ho gaya.", "ok");
        } else {
          setStatus((d && d.error) || "Post nahi hua.");
          toast((d && d.error) || "Post nahi hua.", "");
        }
      })
      .catch(function () { setStatus("Network error."); });
  }

  function delNote(wrap, n) {
    if (!confirm("Ye note delete karna hai?")) return;
    fetch("/api/notepad/" + encodeURIComponent(n.id), {
      method: "DELETE", headers: { "X-CSRF-Token": csrf }
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.success) {
          wrap.remove();
          updateCount();
          toast("Note delete ho gaya.", "ok");
        } else {
          toast((d && d.error) || "Delete nahi hua.", "");
        }
      })
      .catch(function () { toast("Network error.", ""); });
  }

  function startEdit(wrap, n) {
    if (wrap.querySelector(".note-edit-area")) return;
    var body = wrap.querySelector(".note-text");
    var ta = document.createElement("textarea");
    ta.className = "note-edit-area";
    ta.value = n.text || "";
    var row = document.createElement("div");
    row.className = "note-edit-row";
    var save = document.createElement("button");
    save.type = "button"; save.className = "btn btn-primary btn-sm"; save.textContent = "Save";
    var cancel = document.createElement("button");
    cancel.type = "button"; cancel.className = "btn btn-ghost btn-sm"; cancel.textContent = "Cancel";
    row.appendChild(save);
    row.appendChild(cancel);
    body.replaceWith(ta);
    wrap.appendChild(row);
    ta.focus();

    function close() { ta.replaceWith(body); row.remove(); }

    cancel.addEventListener("click", close);
    save.addEventListener("click", function () {
      var text = (ta.value || "").trim();
      if (!text) { toast("Kuch likho.", ""); return; }
      fetch("/api/notepad/" + encodeURIComponent(n.id), {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ text: text })
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.success && d.note) {
            n.text = d.note.text;
            n.edited = d.note.edited;
            body.textContent = d.note.text;
            var timeEl = wrap.querySelector(".note-time");
            if (timeEl) timeEl.textContent = fmtTime(n.created_at) + (d.note.edited ? " \u00b7 edited" : "");
            close();
            toast("Note update ho gaya.", "ok");
          } else {
            toast((d && d.error) || "Edit nahi hua.", "");
          }
        })
        .catch(function () { toast("Network error.", ""); });
    });
  }

  if (area) {
    area.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { post(); }
    });
  }
  if (saveBtn) saveBtn.addEventListener("click", post);

  load();
  setInterval(function () {
    if (document.hidden || document.querySelector(".note-edit-area")) return;
    load();
  }, 15000);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && !document.querySelector(".note-edit-area")) load();
  });
})();
