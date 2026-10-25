(function () {
  "use strict";

  var canvas = document.getElementById("notepadCanvas");
  if (!canvas) return;

  var csrfMeta = document.querySelector('meta[name="csrf-token"]');
  var csrf = csrfMeta ? csrfMeta.getAttribute("content") : "";
  var statusEl = document.getElementById("npStatus");
  var countEl = document.getElementById("npCount");
  var emptyEl = document.getElementById("npEmpty");
  var newBtn = document.getElementById("npNewBtn");
  var toastWrap = document.getElementById("toastWrap");

  var meName = canvas.getAttribute("data-me") || "You";
  var meId = "";
  var selection = null;
  var selectionBusy = false;
  var selectionChangedAt = 0;
  var zTop = 20;
  var firstLoad = true;
  var newCounter = 0;
  var suppressCanvasClick = false;

  function toast(msg, type) {
    if (!toastWrap) return;
    var el = document.createElement("div");
    el.className = "toast toast-" + (type || "info");
    el.textContent = msg;
    toastWrap.appendChild(el);
    setTimeout(function () { el.remove(); }, 3200);
  }

  function setStatus(msg, bad) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.classList.toggle("is-error", !!bad);
  }

  function escSel(value) {
    return String(value == null ? "" : value).replace(/["\\]/g, "\\$&");
  }

  function fmtTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var now = new Date();
    var hm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    if (d.toDateString() === now.toDateString()) return hm;
    return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + " " + hm;
  }

  function clamp(num, min, max) {
    return Math.min(Math.max(num, min), max);
  }

  function notes() {
    return Array.prototype.slice.call(canvas.querySelectorAll(".np-note"));
  }

  function findNoteEl(id) {
    if (!id) return null;
    return canvas.querySelector('.np-note[data-id="' + escSel(id) + '"]');
  }

  function isBusy() {
    return notes().some(function (el) {
      return el._saving || el._dirty || el.contains(document.activeElement);
    });
  }

  function updateEmptyAndCount() {
    var all = notes();
    if (emptyEl) emptyEl.classList.toggle("hidden", all.length > 0);
    if (countEl) {
      countEl.textContent = all.length ? all.length + " note" + (all.length === 1 ? "" : "s") : "";
    }
  }

  function bringFront(el) {
    zTop += 1;
    el.style.zIndex = String(zTop);
  }

  function autogrow(ta) {
    ta.style.height = "auto";
    ta.style.height = Math.min(300, Math.max(34, ta.scrollHeight)) + "px";
  }

  function setPos(el, x, y) {
    var px = Number(x);
    var py = Number(y);
    if (!isFinite(px)) px = 4;
    if (!isFinite(py)) py = 6;
    el.style.setProperty("--x", clamp(px, 0, 100).toFixed(3) + "%");
    el.style.setProperty("--y", clamp(py, 0, 100).toFixed(3) + "%");
  }

  function getPos(el) {
    var x = parseFloat(el.style.getPropertyValue("--x"));
    var y = parseFloat(el.style.getPropertyValue("--y"));
    return {
      x: isFinite(x) ? x : 4,
      y: isFinite(y) ? y : 6
    };
  }

  function refreshStamp(el) {
    var stamp = el.querySelector(".np-stamp");
    if (!stamp) return;
    var t = el._createdAt ? fmtTime(el._createdAt) : "";
    stamp.textContent = (t || "Saved") + (el._edited ? " \u00b7 edited" : "");
  }

  function setNoteStamp(el, text) {
    var stamp = el.querySelector(".np-stamp");
    if (stamp) stamp.textContent = text;
  }

  function applySelection(sel) {
    selection = sel && sel.note_id ? sel : null;
    var id = selection ? selection.note_id : "";
    notes().forEach(function (el) {
      el.classList.toggle("is-selected", !!id && el.getAttribute("data-id") === id);
    });
  }

  function updateBadge(el, note) {
    var name = el.querySelector(".np-badge-name");
    if (name) name.textContent = note.author || "?";
    var badge = el.querySelector(".np-badge");
    if (badge) {
      var title = (note.author || "?") + " ne likha";
      if (note.edited_by) title += " \u00b7 edited by " + note.edited_by;
      badge.title = title + " \u00b7 drag karke move karo";
    }
  }

  function makeBadge(author) {
    var badge = document.createElement("button");
    badge.type = "button";
    badge.className = "np-badge";
    badge.title = (author || "?") + " ne likha \u00b7 drag karke move karo";
    var grip = document.createElement("span");
    grip.className = "np-grip";
    grip.setAttribute("aria-hidden", "true");
    grip.textContent = "\u28ff";
    var name = document.createElement("span");
    name.className = "np-badge-name";
    name.textContent = author || "?";
    badge.appendChild(grip);
    badge.appendChild(name);
    return badge;
  }

  function renderNote(n, isDraft) {
    var draft = !!isDraft;
    var el = document.createElement("div");
    el.className = "np-note" + (draft ? " is-draft" : "");
    el.setAttribute("data-id", n.id || "");
    el.setAttribute("data-author", n.author || "");
    el.setAttribute("data-author-id", n.author_id || "");
    el._draft = draft;
    el._dirty = false;
    el._saving = false;
    el._resave = false;
    el._dragging = false;
    el._posSaving = false;
    el._createdAt = n.created_at || "";
    el._edited = !!n.edited;
    el._savedText = n.text || "";
    el._lastLocalEdit = 0;
    el._posUpdatedAt = 0;
    setPos(el, n.x, n.y);
    bringFront(el);

    var badge = makeBadge(n.author || meName);
    var del = document.createElement("button");
    del.type = "button";
    del.className = "np-del";
    del.title = "Note delete karo";
    del.setAttribute("aria-label", "Note delete karo");
    del.innerHTML = "&times;";

    var ta = document.createElement("textarea");
    ta.className = "np-input";
    ta.rows = 1;
    ta.maxLength = 2000;
    ta.placeholder = "Yahan likho...";
    ta.value = n.text || "";
    ta.setAttribute("aria-label", (n.author || "Note") + " ka note");

    var stamp = document.createElement("div");
    stamp.className = "np-stamp";
    if (n.created_at) {
      stamp.textContent = fmtTime(n.created_at) + (n.edited ? " \u00b7 edited" : "");
    } else {
      stamp.textContent = "Not saved yet";
    }

    el.appendChild(badge);
    el.appendChild(del);
    el.appendChild(ta);
    el.appendChild(stamp);

    badge.addEventListener("click", function (e) { e.stopPropagation(); });
    badge.addEventListener("dblclick", function (e) { e.stopPropagation(); });
    badge.addEventListener("pointerdown", function (e) { startDrag(e, el); });

    del.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      deleteNote(el);
    });
    del.addEventListener("dblclick", function (e) { e.stopPropagation(); });

    el.addEventListener("mousedown", function (e) {
      if (!e.target.closest(".np-del")) bringFront(el);
    });
    el.addEventListener("dblclick", onNoteDoubleClick);

    ta.addEventListener("focus", function () { bringFront(el); });
    ta.addEventListener("input", function () { onNoteInput(el, ta); });
    ta.addEventListener("blur", function () { onNoteBlur(el, ta); });
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        ta.blur();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        queueSave(el, 0);
        ta.blur();
      }
    });

    canvas.appendChild(el);
    autogrow(ta);
    updateEmptyAndCount();
    return el;
  }

  function queueSave(el, delay) {
    if (el._saveTimer) clearTimeout(el._saveTimer);
    el._saveTimer = setTimeout(function () {
      el._saveTimer = null;
      saveNote(el);
    }, delay);
  }

  function onNoteInput(el, ta) {
    autogrow(ta);
    el._dirty = true;
    el._lastLocalEdit = Date.now();
    updateEmptyAndCount();
    setNoteStamp(el, "Saving...");
    setStatus("Saving...");
    queueSave(el, 700);
  }

  function onNoteBlur(el, ta) {
    if (el._saveTimer) {
      clearTimeout(el._saveTimer);
      el._saveTimer = null;
    }
    if (!ta.value.trim()) {
      if (el._draft) {
        el.remove();
        updateEmptyAndCount();
        setStatus("Ready");
        return;
      }
      ta.value = el._savedText || "";
      autogrow(ta);
      el._dirty = false;
      refreshStamp(el);
      setStatus("Khaali note save nahi hota");
      return;
    }
    if (el._dirty || !el.getAttribute("data-id")) saveNote(el);
  }

  function saveNote(el) {
    if (!document.body.contains(el)) return;
    var ta = el.querySelector(".np-input");
    if (!ta) return;
    var text = ta.value;
    var id = el.getAttribute("data-id") || "";
    if (!text.trim()) return;
    if (el._saving) {
      el._resave = true;
      return;
    }

    el._saving = true;
    setNoteStamp(el, "Saving...");
    var pos = getPos(el);
    var payload = { text: text };
    if (!id) {
      payload.x = pos.x;
      payload.y = pos.y;
    }
    var url = id ? "/api/notepad/" + encodeURIComponent(id) : "/api/notepad";
    var method = id ? "PUT" : "POST";

    fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify(payload)
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; });
      })
      .then(function (d) {
        if (d && d.success && d.note) {
          if (!document.body.contains(el)) {
            if (!id) {
              fetch("/api/notepad/" + encodeURIComponent(d.note.id), {
                method: "DELETE",
                headers: { "X-CSRF-Token": csrf }
              }).catch(function () {});
            }
            return;
          }
          el.setAttribute("data-id", d.note.id);
          el.setAttribute("data-author", d.note.author || meName);
          el._draft = false;
          el.classList.remove("is-draft");
          el._createdAt = d.note.created_at || el._createdAt;
          el._edited = !!d.note.edited;
          el._savedText = d.note.text || "";
          el._lastLocalEdit = Date.now();
          updateBadge(el, d.note);
          refreshStamp(el);
          if (ta.value.trim() !== (d.note.text || "").trim()) {
            el._resave = true;
          } else {
            el._dirty = false;
          }
          if (!isBusy()) setStatus("Saved");
        } else if (d && d.error === "login-required") {
          window.location.href = "/login?next=/notepad";
        } else {
          setNoteStamp(el, "Save fail");
          toast((d && d.error) || "Note save nahi hua.", "err");
        }
      })
      .catch(function () {
        setNoteStamp(el, "Network error");
        toast("Network error \u2014 note save nahi hua.", "err");
      })
      .then(function () {
        el._saving = false;
        if (el._resave) {
          el._resave = false;
          queueSave(el, 180);
        }
      });
  }

  function savePosition(el, x, y) {
    var id = el.getAttribute("data-id");
    if (!id) return;
    el._posSaving = true;
    fetch("/api/notepad/" + encodeURIComponent(id), {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ x: x, y: y })
    })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        if (!d || !d.success) toast((d && d.error) || "Note ki jagah save nahi hui.", "err");
      })
      .catch(function () {
        toast("Network error \u2014 note ki jagah save nahi hui.", "err");
      })
      .then(function () {
        el._posSaving = false;
      });
  }

  function deleteNote(el) {
    var id = el.getAttribute("data-id");
    if (!id) {
      el.remove();
      updateEmptyAndCount();
      setStatus("Ready");
      return;
    }
    if (!confirm("Ye note delete karna hai?")) return;
    fetch("/api/notepad/" + encodeURIComponent(id), {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrf }
    })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        if (!d || !d.success) {
          toast((d && d.error) || "Note delete nahi hua.", "err");
          return;
        }
        if (selection && selection.note_id === id) applySelection(null);
        el.remove();
        updateEmptyAndCount();
        setStatus("Note delete ho gaya");
        toast("Note delete ho gaya.", "ok");
      })
      .catch(function () { toast("Network error \u2014 note delete nahi hua.", "err"); });
  }

  function onNoteDoubleClick(e) {
    var el = e.target.closest(".np-note");
    if (!el || e.target.closest(".np-del")) return;
    var id = el.getAttribute("data-id");
    if (!id) {
      setStatus("Pehle note save hone do...");
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (window.getSelection) window.getSelection().removeAllRanges();
    selectNote(id);
  }

  function selectNote(id) {
    if (selectionBusy) return;
    var next = selection && selection.note_id === id ? "" : id;
    selectionBusy = true;
    applySelection(next ? { note_id: next, by: meName, at: "" } : null);
    setStatus(next ? "Selecting..." : "Selection hata rahe...");
    fetch("/api/notepad/select", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ note_id: next })
    })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        selectionBusy = false;
        if (d && d.success) {
          selectionChangedAt = Date.now();
          applySelection(d.selection || null);
          setStatus(d.selection ? "Red selection set" : "Selection hata di");
        } else {
          toast((d && d.error) || "Selection save nahi hui.", "err");
          load();
        }
      })
      .catch(function () {
        selectionBusy = false;
        toast("Network error \u2014 selection save nahi hui.", "err");
        load();
      });
  }

  function startDrag(e, el) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (el._dragging) return;
    e.preventDefault();
    e.stopPropagation();
    bringFront(el);

    var canvasRect = canvas.getBoundingClientRect();
    var noteRect = el.getBoundingClientRect();
    var startX = e.clientX;
    var startY = e.clientY;
    var startLeft = noteRect.left - canvasRect.left + canvas.scrollLeft;
    var startTop = noteRect.top - canvasRect.top + canvas.scrollTop;
    var maxLeft = Math.max(4, canvas.clientWidth - noteRect.width - 4);
    var maxTop = Math.max(4, canvas.clientHeight - 40);
    var left = startLeft;
    var top = startTop;

    el._dragging = true;
    el.classList.add("is-dragging");
    suppressCanvasClick = true;

    function move(ev) {
      if (!el._dragging) return;
      left = clamp(startLeft + ev.clientX - startX, 4, maxLeft);
      top = clamp(startTop + ev.clientY - startY, 4, maxTop);
      el.style.left = left + "px";
      el.style.top = top + "px";
    }

    function done() {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", done);
      document.removeEventListener("pointercancel", done);
      if (!el._dragging) return;
      el._dragging = false;
      el.classList.remove("is-dragging");
      el.style.removeProperty("left");
      el.style.removeProperty("top");
      var w = Math.max(1, canvas.clientWidth);
      var h = Math.max(1, canvas.clientHeight);
      var xPct = Math.round(clamp(left / w * 100, 0, 100) * 1000) / 1000;
      var yPct = Math.round(clamp(top / h * 100, 0, 100) * 1000) / 1000;
      setPos(el, xPct, yPct);
      el._posUpdatedAt = Date.now();
      savePosition(el, xPct, yPct);
      setTimeout(function () { suppressCanvasClick = false; }, 80);
    }

    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", done);
    document.addEventListener("pointercancel", done);
  }

  function createDraftAtPoint(clientX, clientY) {
    notes().forEach(function (el) {
      if (el._draft && !(el.querySelector(".np-input").value || "").trim()) el.remove();
    });
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, canvas.clientWidth);
    var h = Math.max(1, canvas.clientHeight);
    var rawX = clientX - rect.left + canvas.scrollLeft;
    var rawY = clientY - rect.top + canvas.scrollTop;
    var left = clamp(rawX - 14, 6, Math.max(6, w - 268));
    var top = clamp(rawY - 14, 6, Math.max(6, h - 92));
    var el = renderNote({
      id: "",
      author: meName,
      author_id: meId,
      text: "",
      x: left / w * 100,
      y: top / h * 100,
      created_at: ""
    }, true);
    var ta = el.querySelector(".np-input");
    if (ta) setTimeout(function () { ta.focus(); }, 0);
    setStatus("Typing...");
  }

  canvas.addEventListener("click", function (e) {
    if (suppressCanvasClick) {
      suppressCanvasClick = false;
      return;
    }
    if (e.target.closest(".np-note")) return;
    createDraftAtPoint(e.clientX, e.clientY);
  });

  if (newBtn) {
    newBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      notes().forEach(function (el) {
        if (el._draft && !(el.querySelector(".np-input").value || "").trim()) el.remove();
      });
      var w = Math.max(1, canvas.clientWidth);
      var h = Math.max(1, canvas.clientHeight);
      var step = newCounter % 7;
      newCounter += 1;
      var left = clamp(24 + step * 26, 6, Math.max(6, w - 268));
      var top = clamp(24 + step * 22, 6, Math.max(6, h - 100));
      var el = renderNote({
        id: "",
        author: meName,
        author_id: meId,
        text: "",
        x: left / w * 100,
        y: top / h * 100,
        created_at: ""
      }, true);
      var ta = el.querySelector(".np-input");
      if (ta) setTimeout(function () { ta.focus(); }, 0);
      setStatus("Typing...");
    });
  }

  function mergeNotes(serverNotes, sel) {
    var byId = {};
    serverNotes.forEach(function (n) { byId[n.id] = n; });

    notes().forEach(function (el) {
      var id = el.getAttribute("data-id");
      if (!id) return;
      if (!byId[id]) {
        if (el._saving || el._dirty || el.contains(document.activeElement)) return;
        el.remove();
        return;
      }
      var n = byId[id];
      el._createdAt = n.created_at || el._createdAt;
      el._edited = !!n.edited;
      updateBadge(el, n);
      var ta = el.querySelector(".np-input");
      if (ta && !el._dirty && !el._saving && !el.contains(document.activeElement)
          && Date.now() - (el._lastLocalEdit || 0) > 1500) {
        if (ta.value !== n.text) {
          ta.value = n.text;
          el._savedText = n.text;
          autogrow(ta);
          refreshStamp(el);
        }
      }
      if (!el._dragging && !el._posSaving && Date.now() - (el._posUpdatedAt || 0) > 1500) {
        setPos(el, n.x, n.y);
      }
    });

    serverNotes.forEach(function (n) {
      if (!findNoteEl(n.id)) renderNote(n, false);
    });

    if (!selectionBusy && Date.now() - selectionChangedAt > 1200) applySelection(sel);
    updateEmptyAndCount();
  }

  function load() {
    if (document.hidden) return;
    fetch("/api/notepad", {
      headers: { "X-CSRF-Token": csrf },
      cache: "no-store"
    })
      .then(function (r) {
        if (r.status === 401) {
          window.location.href = "/login?next=/notepad";
          throw new Error("auth");
        }
        return r.json();
      })
      .then(function (d) {
        if (d && d.success) {
          meId = d.me_id || meId;
          mergeNotes(d.notes || [], d.selection || null);
          if (firstLoad) {
            firstLoad = false;
            setStatus("Ready");
          } else if (!isBusy()) {
            setStatus("Live");
          }
        } else {
          setStatus("Load nahi hua", true);
        }
      })
      .catch(function (err) {
        if (!err || err.message !== "auth") setStatus("Network error", true);
      });
  }

  load();
  setInterval(function () { load(); }, 10000);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) load();
  });
})();
