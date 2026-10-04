(function () {
  var root = document.getElementById("chatRoot");
  if (!root) return;

  var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || "";
  var bubble = document.getElementById("chatBubble");
  var panel = document.getElementById("chatPanel");
  var badge = document.getElementById("chatBadge");
  var msgs = document.getElementById("chatMsgs");
  var text = document.getElementById("chatText");
  var send = document.getElementById("chatSend");
  var file = document.getElementById("chatFile");
  var muteBtn = document.getElementById("chatMute");
  var minBtn = document.getElementById("chatMin");

  var OPEN = false;
  var lastId = "";
  var meId = "";
  var unread = 0;
  var muted = false;
  var had = false;
  try { muted = localStorage.getItem("chatMutedV2") === "1"; } catch (e) {}
  setMuteIcon();

  function setMuteIcon() {
    if (!muteBtn) return;
    muteBtn.innerHTML = muted ? "&#128263;" : "&#128266;";
    muteBtn.title = muted ? "Beep on karo" : "Beep mute karo";
  }

  function el(tag, cls, textContent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (textContent != null) n.textContent = textContent;
    return n;
  }

  function fmtTime(ts) {
    if (!ts) return "";
    var d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    var h = d.getHours(), m = d.getMinutes();
    var ap = h >= 12 ? "PM" : "AM";
    h = h % 12; if (h === 0) h = 12;
    return (h < 10 ? "0" + h : h) + ":" + (m < 10 ? "0" + m : m) + " " + ap;
  }

  var lastDayKey = "";
  function sameLocalDay(a, b) {
    if (!a || !b) return false;
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function dayChip(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return { key: "", label: "" };
    var key = d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
    var label = "";
    var now = new Date();
    if (sameLocalDay(d, now)) {
      label = "TODAY";
    } else {
      var yes = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      if (sameLocalDay(d, yes)) label = "YESTERDAY";
    }
    if (!label) {
      var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      label = d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
    }
    return { key: key, label: label };
  }

  function appendMsg(m) {
    if (msgs.querySelector('[data-mid="' + m.id + '"]')) return;
    var mine = m.user_id && m.user_id === meId;
    var row = document.createElement("div");
    row.className = "chat-row" + (mine ? " mine" : "");
    row.setAttribute("data-mid", m.id);
    var bubbleHtml = document.createElement("div");
    bubbleHtml.className = "chat-bubble2";
    var meta = el("div", "chat-meta");
    meta.appendChild(el("b", "chat-user", m.username || "?"));
    meta.appendChild(el("span", "chat-time", fmtTime(m.ts)));
    bubbleHtml.appendChild(meta);
    if (m.image && m.img_url) {
      var img = document.createElement("img");
      img.className = "chat-img";
      img.src = m.img_url;
      img.alt = "image";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("click", function () { window.open(m.img_url, "_blank"); });
      bubbleHtml.appendChild(img);
    }
    if (m.text) {
      bubbleHtml.appendChild(el("div", "chat-text", m.text));
    }
    if (!(m.image || m.text)) bubbleHtml.appendChild(el("div", "chat-text", "…"));
    row.appendChild(bubbleHtml);
    var day = dayChip(m.ts);
    if (day.key && day.key !== lastDayKey) {
      lastDayKey = day.key;
      msgs.appendChild(el("div", "day-chip", day.label));
    }
    msgs.appendChild(row);
    scroll(true);
  }

  function scroll(force) {
    if (force || OPEN) {
      msgs.scrollTop = msgs.scrollHeight;
    }
  }

  function renderBadge() {
    if (!badge) return;
    try {
      if (unread > 0) {
        badge.textContent = unread > 99 ? "99+" : String(unread);
        badge.classList.remove("hidden");
      } else {
        badge.classList.add("hidden");
      }
    } catch (e) {}
  }

  function chatToast(txt, type) {
    var w = document.querySelector(".toast-wrap") || document.querySelector("#toastWrap");
    if (w && window.toast) { window.toast(txt, type); return; }
    var t = el("div", "chat-toast " + (type || ""));
    t.textContent = txt;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add("show"); }, 20);
    setTimeout(function () {
      t.classList.remove("show");
      setTimeout(function () { t.remove(); }, 300);
    }, 2600);
  }

function notify(m) {
    var preview = m.text ? (m.text.length > 46 ? m.text.slice(0, 45) + "\u2026" : m.text) : (m.image ? "Photo bheji hai" : "");
    chatToast(m.username + (preview ? ": " + preview : ""), "ok");
    updateTabTitle(m.username);
  }

  function updateTabTitle(username) {
    if (!document.hidden) return;
    try {
      var orig = document.body.getAttribute("data-orig-title");
      if (!orig) {
        orig = document.title;
        document.body.setAttribute("data-orig-title", orig);
      }
      document.title = "(" + unread + ") " + username + " - " + orig;
      var onvis = function () {
        if (!document.hidden) {
          document.title = document.body.getAttribute("data-orig-title") || orig;
          document.removeEventListener("visibilitychange", onvis);
        }
      };
      document.addEventListener("visibilitychange", onvis);
    } catch (e) {}
  }

  var actx = null;
  function ensureAudio() {
    if (!actx) {
      try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
    }
    if (actx && actx.state === "suspended") { actx.resume(); }
  }
  function beep() {
    if (muted) return;
    ensureAudio();
    if (!actx) return;
    var now = actx.currentTime;
    [880, 1320].forEach(function (f, i) {
      var o = actx.createOscillator();
      var g = actx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      var t0 = now + i * 0.13;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
      o.connect(g);
      g.connect(actx.destination);
      o.start(t0);
      o.stop(t0 + 0.15);
    });
  }
  document.addEventListener("pointerdown", ensureAudio, { once: true });

  function markRead() {
    if (!OPEN) return;
    unread = 0;
    renderBadge();
  }

  function openPanel(show) {
    OPEN = show;
    panel.classList.toggle("hidden", !show);
    if (show) {
      bubble.classList.add("chat-bubble-active");
      markRead();
      scroll(false);
      text.focus();
    } else {
      bubble.classList.remove("chat-bubble-active");
    }
  }

  bubble.addEventListener("click", function () { openPanel(!OPEN); });
  if (minBtn) minBtn.addEventListener("click", function () {
    if (OPEN) openPanel(false);
  });
  var clearBtn = document.getElementById("chatClear");
  if (clearBtn) clearBtn.addEventListener("click", function () {
    if (!window.confirm("PURANA chat (aaj ke alawa) delete ho jayega. Aaj ke messages safe rahenge. Chalega?")) return;
    clearBtn.disabled = true;
    fetch("/api/chat/messages/history", {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrf }
    }).then(function (r) {
      return r.json().catch(function () {
        return { success: false, error: "Server error (HTTP " + r.status + ") - server restart chahiye hoga." };
      });
    }).then(function (d) {
      if (d && d.success) {
        msgs.innerHTML = "";
        lastId = "";
        had = false;
        unread = 0;
        lastDayKey = "";
        renderBadge();
        chatToast((d.deleted || 0) + " purane message delete. Aaj ke bache hain.", "ok");
        pollNow();
      } else {
        chatToast((d && d.error) || "Purana chat clear nahi hua.", "");
      }
    }).catch(function () {
      chatToast("Network problem. Dobara try karo.", "");
    }).then(function () {
      clearBtn.disabled = false;
    });
  });
  muteBtn.addEventListener("click", function () {
    muted = !muted;
    try { localStorage.setItem("chatMutedV2", muted ? "1" : "0"); } catch (e) {}
    setMuteIcon();
    chatToast(muted ? "Beep mute hai." : "Beep on ho gaya.", muted ? "" : "ok");
  });

  function syncSendState() {
    if (!send) return;
    var has = !!(text.value || "").trim();
    send.classList.toggle("ready", has);
  }
  syncSendState();
  text.addEventListener("input", syncSendState);

  text.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); sendText(); }
  });
  send.addEventListener("click", sendText);

  function sendText() {
    var v = text.value.trim();
    if (!v) { text.focus(); return; }
    send.disabled = true;
    fetch("/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ text: v })
    }).then(function (r) { return r.json(); }).then(function (d) {
      send.disabled = false;
if (d.success) {
      text.value = "";
      syncSendState();
      appendMsg(d.msg);
      text.focus();
      } else {
        chatToast(d.error || "Bhejne me problem.", "");
      }
    }).catch(function () {
      send.disabled = false;
      chatToast("Network problem.", "");
    });
  }

  file.addEventListener("change", function () {
    var f = file.files && file.files[0];
    if (!f) return;
    if (["image/png", "image/jpeg", "image/gif", "image/webp"].indexOf(f.type) === -1) {
      chatToast("Sirf image bhej sakte ho.", "");
      file.value = "";
      return;
    }
    var fd = new FormData();
    fd.append("file", f);
    send.disabled = true;
    fetch("/api/chat/images", {
      method: "POST",
      headers: { "X-CSRF-Token": csrf },
      body: fd
    }).then(function (r) { return r.json(); }).then(function (d) {
      send.disabled = false;
      file.value = "";
      if (d.success) {
        appendMsg(d.msg);
      } else {
        chatToast(d.error || "Image bheji nahi ja saki.", "");
      }
    }).catch(function () {
      send.disabled = false;
      file.value = "";
      chatToast("Network problem.", "");
    });
  });

  function pollNow() {
    fetch("/api/chat/messages" + (lastId ? "?since=" + encodeURIComponent(lastId) : ""), {
      headers: { "X-CSRF-Token": csrf }
    }).then(function (r) {
      if (r.status === 401) { shutdown(); return null; }
      return r.json();
    }).then(function (d) {
      if (!d || !d.success) return;
      var first = !had;
      meId = d.me_id || "";
      var fresh = [];
      (d.messages || []).forEach(function (m) {
        if (msgs.querySelector('[data-mid="' + m.id + '"]')) { lastId = m.id; return; }
        try { appendMsg(m); } catch (e) {}
        lastId = m.id;
        if (!first && m.user_id && m.user_id !== meId && !OPEN) fresh.push(m);
      });
      had = true;
      if (first) {
        unread = 0;
        markRead();
        scroll(false);
        renderBadge();
        return;
      }
      if (fresh.length) {
        unread += fresh.length;
        if (unread > 99) unread = 99;
        renderBadge();
        fresh.forEach(function (m) {
          try { beep(); } catch (e) {}
          try { notify(m); } catch (e) {}
        });
      } else {
        renderBadge();
      }
    }).catch(function () {});
  }

  function shutdown() {
    try { clearInterval(interval); } catch (e) {}
    interval = null;
    if (root) root.classList.add("hidden");
  }

  // ============================================================ Voice group call
  function apiPost(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json(); });
  }

  var callBtn = document.getElementById("chatCall");
  var callBar = document.getElementById("callBar");
  var callPeers = document.getElementById("callPeers");
  var callMuteBtn = document.getElementById("callMute");
  var callLeaveBtn = document.getElementById("callLeave");
  var speakerBtn = document.getElementById("callSpeaker");
  var callAudio = document.getElementById("callAudio");

  // ---- Speaker / hands-free (default ON) ----
  var speakerOn = true;
  try { speakerOn = localStorage.getItem("callSpeakerOn") !== "0"; } catch (e) {}

  function speakerSinkId() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return Promise.resolve("");
    return navigator.mediaDevices.enumerateDevices().then(function (list) {
      var outs = [];
      for (var i = 0; i < (list || []).length; i++) {
        if (list[i].kind === "audiooutput") outs.push(list[i]);
      }
      if (!outs.length) return "";
      var sp = null;
      for (var j = 0; j < outs.length; j++) {
        if (/speaker|speakerphone|loudspeaker|built-in|bt_|headset/i.test(outs[j].label || "")) { sp = outs[j]; break; }
      }
      return ((sp || outs[0]).deviceId) || "";
    }).catch(function () { return ""; });
  }

  function applySpeaker() {
    if (!callAudio) return Promise.resolve(false);
    var els = callAudio.querySelectorAll("audio");
    if (!els.length) return Promise.resolve(false);
    var canSet = false;
    for (var i = 0; i < els.length; i++) {
      if (typeof els[i].setSinkId === "function") { canSet = true; break; }
    }
    if (!canSet) return Promise.resolve(false);
    return speakerSinkId().then(function (id) {
      if (!id) return false;
      var jobs = [];
      for (var k = 0; k < els.length; k++) {
        (function (a) {
          if (typeof a.setSinkId !== "function") return;
          var pr = a.setSinkId(id);
          if (pr && pr.then) pr.then(function () {}).catch(function () {});
        })(els[k]);
      }
      return jobs.length > 0 || true;
    }).catch(function () { return false; });
  }

  function setSpeaker(on, announce) {
    speakerOn = !!on;
    try { localStorage.setItem("callSpeakerOn", speakerOn ? "1" : "0"); } catch (e) {}
    if (speakerBtn) {
      speakerBtn.classList.toggle("call-speaker-on", speakerOn);
      speakerBtn.title = speakerOn ? "Speaker on (hands-free)" : "Speaker off";
    }
    if (!announce) return;
    applySpeaker().then(function (ok) {
      if (ok) {
        chatToast(speakerOn ? "Speaker on — hands-free." : "Speaker off.", "ok");
      } else {
        chatToast(speakerOn
          ? "Browser ne speaker control nahi diya — phone ka speaker button dabao."
          : "Speaker off (device pe manually band karo).", "");
      }
    });
  }

  if (speakerBtn) {
    setSpeaker(speakerOn, false);
    speakerBtn.addEventListener("click", function () { setSpeaker(!speakerOn, true); });
  }

  var call = {
    active: false,
    stream: null,
    since: "",
    pcs: {}, // peerId -> {pc, name, ice:[]}
    names: {},
    timer: null,
    micOn: true
  };

  var iceServers = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
      { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
      { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" }
    ]
  };

  function callChip(name) {
    var c = document.createElement("span");
    c.className = "call-chip";
    c.textContent = "\uD83C\uDF99\uFE0F " + (name || "?");
    return c;
  }

  function updateCallUI() {
    if (!callPeers) return;
    callPeers.textContent = "";
    Object.keys(call.pcs).forEach(function (uid) {
      callPeers.appendChild(callChip(call.pcs[uid].name));
    });
    if (callAudio) {
      var els = callAudio.querySelectorAll("audio");
      if (els.length === 0 && Object.keys(call.pcs).length > 0) {
        var info = document.createElement("div");
        info.className = "call-tip";
        info.textContent = "Call live hai \u2014 baat karo.";
        callAudio.appendChild(info);
      }
      if (els.length > 0) {
        var tips = callAudio.querySelectorAll(".call-tip");
        tips.forEach(function (t) { t.remove(); });
      }
    }
  }

  function getOrCreatePeer(uid, name) {
    if (call.pcs[uid]) return call.pcs[uid];
    var pc = new RTCPeerConnection(iceServers);
    call.pcs[uid] = { pc: pc, name: name || "?", ice: [] };

    try {
      (call.stream || []).getTracks().forEach(function (t) { pc.addTrack(t, call.stream); });
    } catch (e) {}

    pc.onicecandidate = function (ev) {
      if (ev.candidate) {
        apiPost("/api/call/signal", { to: uid, kind: "ice", payload: ev.candidate }).catch(function () {});
      }
    };
    pc.ontrack = function (ev) {
      try {
        var audio = document.createElement("audio");
        audio.autoplay = true;
        audio.setAttribute("playsinline", "");
        audio.setAttribute("data-peer", uid);
        audio.srcObject = ev.streams && ev.streams[0];
        audio.volume = 1;
        if (callAudio) callAudio.appendChild(audio);
        if (speakerOn) applySpeaker();
        var pr = audio.play();
        if (pr && pr.catch) {
          pr.catch(function () {
            var retry = function () {
              var q = audio.play();
              if (q && q.catch) q.catch(function () {});
              document.removeEventListener("click", retry);
              document.removeEventListener("touchstart", retry);
            };
            document.addEventListener("click", retry);
            document.addEventListener("touchstart", retry);
          });
        }
      } catch (e) {}
    };
    pc.onconnectionstatechange = function () {
      if (pc.connectionState === "connected") {
        chatToast("Call connected.", "ok");
      }
    };
    pc.onconnectionstatechange = function () {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        call.pcs[uid].ice = [];
        setTimeout(function () {
          if (call.pcs[uid] && call.active) {
            apiPost("/api/call/signal", { to: uid, kind: "offer", payload: { again: true } }).catch(function () {});
          }
        }, 1500);
      }
    };
    updateCallUI();
    return call.pcs[uid];
  }

  function removePeer(uid) {
    var entry = call.pcs[uid];
    if (!entry) return;
    try { entry.pc.close(); } catch (e) {}
    delete call.pcs[uid];
    if (callAudio) {
      callAudio.querySelectorAll('audio[data-peer="' + uid + '"]').forEach(function (a) { a.remove(); });
    }
    updateCallUI();
  }

  function sendOffer(uid) {
    var entry = getOrCreatePeer(uid, (call.pcs[uid] && call.pcs[uid].name) || "?");
    entry.pc.createOffer().then(function (offer) {
      return entry.pc.setLocalDescription(offer);
    }).then(function () {
      return apiPost("/api/call/signal", {
        to: uid, kind: "offer", payload: entry.pc.localDescription
      });
    }).catch(function () {
      apiPost("/api/call/signal", { to: uid, kind: "offer", payload: { again: true } }).catch(function () {});
    });
  }

  function handleSignal(sig) {
    if (!sig || !sig.from || sig.from === meId) return;
    if (sig.kind === "offer") {
      var entry = getOrCreatePeer(sig.from, call.names[sig.from] || "?");
      entry.pc.setRemoteDescription(sig.payload).then(function () {
        return entry.pc.createAnswer();
      }).then(function (ans) {
        return entry.pc.setLocalDescription(ans);
      }).then(function () {
        return apiPost("/api/call/signal", {
          to: sig.from, kind: "answer", payload: entry.pc.localDescription
        });
      }).catch(function () {});
    } else if (sig.kind === "answer") {
      var e2 = call.pcs[sig.from];
      if (!e2) return;
      e2.pc.setRemoteDescription(sig.payload).then(function () {
        (e2.ice || []).forEach(function (c) {
          try { e2.pc.addIceCandidate(c); } catch (err) {}
        });
        e2.ice = [];
      }).catch(function () {});
    } else if (sig.kind === "ice") {
      var e3 = call.pcs[sig.from];
      if (!e3) return;
      if (e3.pc.remoteDescription) {
        e3.pc.addIceCandidate(sig.payload).catch(function () {});
      } else {
        e3.ice.push(sig.payload);
      }
    } else if (sig.kind === "left") {
      removePeer(sig.from);
    }
  }

  function ensurePeer(uid, name) {
    if (!call.active) return;
    call.names[uid] = name;
    if (!call.pcs[uid]) {
      sendOffer(uid);
    }
  }

  function callPoll() {
    fetch("/api/call/state?since=" + encodeURIComponent(call.since), {
      headers: { "X-CSRF-Token": csrf }
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.success) { return; }
      call.since = d.since || call.since;
      (d.signals || []).forEach(handleSignal);
      var live = {};
      (d.participants || []).forEach(function (p) {
        live[p.user_id] = true;
        if (!call.pcs[p.user_id]) ensurePeer(p.user_id, p.username);
        if (call.pcs[p.user_id]) call.pcs[p.user_id].name = p.username;
      });
      Object.keys(call.pcs).forEach(function (uid) {
        if (!live[uid]) removePeer(uid);
      });
      updateCallUI();
    }).catch(function () {});
  }

  function joinCall() {
    if (call.active) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      chatToast("Is browser me voice call support nahi hai.", "");
      return;
    }
    navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    }).then(function (stream) {
      call.stream = stream;
      call.active = true;
      call.names = {};
      call.micOn = true;
      call.since = "";
      if (callBar) callBar.classList.remove("hidden");
      if (callBtn) callBtn.classList.add("chat-call-active");
      if (callAudio) callAudio.innerHTML = "";
      updateCallUI();
      apiPost("/api/call/join", {}).then(function (d) {
        if (d && d.success) {
          call.since = d.since || "";
          (d.signals || []).forEach(handleSignal);
          (d.participants || []).forEach(function (p) {
            call.names[p.user_id] = p.username;
            if (!call.pcs[p.user_id]) ensurePeer(p.user_id, p.username);
          });
        }
      }).catch(function () {});
      call.timer = setInterval(callPoll, 1200);
      chatToast("Voice call join ho gayi.", "ok");
      if (speakerOn) {
        setTimeout(function () {
          applySpeaker().then(function (ok) {
            if (!ok) chatToast("Speaker ke liye phone ka speaker button dabao.", "");
          });
        }, 800);
      }
    }).catch(function () {
      chatToast("Mic permission nahi mili.", "");
    });
  }

  function leaveCall() {
    if (!call.active) return;
    clearInterval(call.timer);
    call.timer = null;
    apiPost("/api/call/leave", {}).catch(function () {});
    Object.keys(call.pcs).forEach(removePeer);
    if (call.stream) {
      try { call.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    }
    call.stream = null;
    call.pcs = {};
    call.names = {};
    call.active = false;
    if (callBar) callBar.classList.add("hidden");
    if (callBtn) callBtn.classList.remove("chat-call-active");
    if (callAudio) callAudio.innerHTML = "";
    updateCallUI();
    chatToast("Call khatam.", "");
  }

  if (callBtn) callBtn.addEventListener("click", joinCall);
  if (callLeaveBtn) callLeaveBtn.addEventListener("click", leaveCall);
  if (callMuteBtn) callMuteBtn.addEventListener("click", function () {
    if (!call.active || !call.stream) return;
    call.micOn = !call.micOn;
    call.stream.getAudioTracks().forEach(function (t) { t.enabled = call.micOn; });
    callMuteBtn.innerHTML = call.micOn ? "\uD83C\uDFA4" : "\uD83D\uDD07";
    chatToast(call.micOn ? "Mic on." : "Mic muted.", call.micOn ? "ok" : "");
  });

  window.addEventListener("beforeunload", function () {
    if (call.active) { apiPost("/api/call/leave", {}).catch(function () {}); }
  });

  var interval = null;
  pollNow();
  interval = setInterval(pollNow, 3000);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) pollNow();
  });
  window.addEventListener("focus", pollNow);
})();