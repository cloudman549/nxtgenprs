(function () {
  "use strict";

  var INSTALLED_KEY = "app_installed_v1";
  var deferred = null;
  var logo = null;

  function isStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      window.matchMedia("(display-mode: minimal-ui)").matches ||
      window.navigator.standalone === true
    );
  }

  function isIOS() {
    var ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod/i.test(ua)) return true;
    // iPadOS 13+ reports itself as Macintosh
    if (/Macintosh|Mac OS X/i.test(ua) && navigator.maxTouchPoints > 1) return true;
    return false;
  }

  function isSafari() {
    var ua = navigator.userAgent || "";
    return /^((?!chrome|chromium|crios|android|fxios|edgios|opr\/).)*safari/i.test(ua);
  }

  function isFirefox() {
    return /firefox|fxios/i.test(navigator.userAgent || "");
  }

  function toast(msg) {
    if (typeof window.toast === "function") {
      try { window.toast(msg); return; } catch (e) {}
    }
  }

  function markInstalled() {
    try { localStorage.setItem(INSTALLED_KEY, "1"); } catch (e) {}
    if (logo) logo.classList.remove("installable");
  }

  // ------------------------------------------------------------ instructions modal
  function showSheet(title, steps) {
    var old = document.getElementById("installSheet");
    if (old) old.remove();

    var wrap = document.createElement("div");
    wrap.id = "installSheet";
    wrap.className = "install-sheet";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-label", title);

    var card = document.createElement("div");
    card.className = "install-sheet-card";

    var h = document.createElement("h3");
    h.className = "install-sheet-title";
    h.textContent = title;
    card.appendChild(h);

    var ol = document.createElement("ol");
    ol.className = "install-sheet-steps";
    steps.forEach(function (s) {
      var li = document.createElement("li");
      li.textContent = s;
      ol.appendChild(li);
    });
    card.appendChild(ol);

    var close = document.createElement("button");
    close.type = "button";
    close.className = "install-sheet-close";
    close.textContent = "Theek hai";
    close.addEventListener("click", function () { wrap.remove(); });
    card.appendChild(close);

    wrap.appendChild(card);
    wrap.addEventListener("click", function (e) {
      if (e.target === wrap) wrap.remove();
    });

    document.body.appendChild(wrap);
    document.addEventListener("keydown", function onEsc(e) {
      if (e.key === "Escape") {
        wrap.remove();
        document.removeEventListener("keydown", onEsc);
      }
    });
  }

  function iosSteps() {
    if (window.navigator.standalone) return [];
    return [
      "Safari me bottom me Share button (▲ box se arrow) tap karo.",
      "List me neeche “Add to Home Screen” tap karo.",
      "Top right me “Add” dabayein — desktop icon ban jayega.",
      "Ab app asli app jaisi khulegi (browser bar ke bina)."
    ];
  }

  function desktopSteps() {
    if (isSafari()) {
      return [
        "Safari menu bar me “File” → “Add to Dock…” tap karo.",
        "Confirm karo — app Dock me aur Spotlight me aa jayegi."
      ];
    }
    if (isFirefox()) {
      return [
        "Firefox me address bar ke right side me install icon (↓) click karo.",
        "Ya menu (☰) → “Install” / “Install App” choose karo."
      ];
    }
    return [
      "Address bar ke right side me install icon (⊕ / monitor) click karo.",
      "Ya browser menu (⋮) → “Cast, save and share” → “Install page as app”.",
      "Ya Windows: Start menu → “Install page as app…”."
    ];
  }

  // ------------------------------------------------------------ main action
  function install() {
    if (isStandalone()) {
      toast("App pehle se install hai.");
      return;
    }

    if (deferred) {
      var p = deferred;
      deferred = null;
      p.prompt();
      p.userChoice.then(function (choice) {
        if (choice && choice.outcome === "accepted") {
          markInstalled();
          toast("App install ho gaya.");
        } else {
          toast("Install cancel kar diya.");
          arm();
        }
      }).catch(function () { arm(); });
      return;
    }

    // No programmatic prompt available — give platform steps.
    if (isIOS()) {
      showSheet("iPhone/iPad pe app install karo", iosSteps());
      return;
    }
    showSheet("App install karo (Computer)", desktopSteps());
  }

  function arm() {
    if (!logo) return;
    if (isStandalone()) { logo.classList.remove("installable"); return; }
    if (!deferred && !("onbeforeinstallprompt" in window)) return;
    logo.classList.add("installable");
  }

  function bind() {
    logo = document.getElementById("brandInstall");
    if (!logo) return;

    logo.addEventListener("click", function (e) {
      // it's inside <a class="brand"> — stop navigation
      e.preventDefault();
      e.stopPropagation();
      install();
    });
    logo.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        e.stopPropagation();
        install();
      }
    });

    if (isStandalone()) {
      logo.classList.add("is-installed");
      logo.title = "App install hai";
      return;
    }

    try {
      if (localStorage.getItem(INSTALLED_KEY)) logo.classList.add("is-installed");
    } catch (e) {}

    arm();
  }

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferred = e;
    arm();
  });

  window.addEventListener("appinstalled", function () {
    deferred = null;
    markInstalled();
    if (logo) logo.title = "App install hai";
    toast("App install ho gaya — shortcut ban gaya.");
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();