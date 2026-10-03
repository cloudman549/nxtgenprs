(function () {
  "use strict";

  var DISMISS_KEY = "install_prompt_dismissed_v1";

  // Sirf desktop/laptop par dikhao — mobile par nahi.
  function isMobileDevice() {
    var ua = navigator.userAgent || "";
    if (/Android|iPhone|iPad|iPod|Mobile|BlackBerry|Opera Mini|IEMobile/i.test(ua)) return true;
    if (/Macintosh|Mac OS X/i.test(ua) && navigator.maxTouchPoints > 1) return true;
    if (window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 900) return true;
    if (window.innerWidth < 768) return true;
    return false;
  }

  function isStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    );
  }

  if (isMobileDevice() || isStandalone()) return;

  var deferred = null;
  var btn = null;

  function show(onClick) {
    if (btn || !document.body) return;
    var el = document.createElement("button");
    el.type = "button";
    el.id = "installDesktopBtn";
    el.className = "install-fab";
    el.setAttribute("aria-label", "Add to Desktop");
    el.innerHTML =
      '<span class="install-fab-ico" aria-hidden="true">&#128187;</span>' +
      '<span class="install-fab-txt">Add to Desktop</span>';
    el.addEventListener("click", onClick);
    document.body.appendChild(el);
    btn = el;
    requestAnimationFrame(function () {
      btn.classList.add("install-fab-show");
    });
  }

  function hide() {
    if (!btn) return;
    btn.classList.remove("install-fab-show");
    setTimeout(function () {
      if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
      btn = null;
    }, 350);
  }

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferred = e;
    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch (err) {}
    show(function () {
      if (!deferred) return;
      hide();
      deferred.prompt();
      deferred.userChoice.then(function (choice) {
        if (choice && choice.outcome === "accepted") {
          try { localStorage.setItem(DISMISS_KEY, "1"); } catch (err) {}
        }
        deferred = null;
      });
    });
  });

  window.addEventListener("appinstalled", function () {
    hide();
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch (err) {}
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }
})();