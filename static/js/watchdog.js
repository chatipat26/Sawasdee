/**
 * Fail-safe Watchdog: Guarantees splash screen is dismissed even if scripts/CDNs/network lag.
 */
(function() {
  var splashTimer = setTimeout(function() {
    var splash = document.getElementById("app-splash-screen");
    if (splash && splash.style.display !== "none") {
      splash.classList.add("fade-out");
      setTimeout(function() { if (splash) splash.style.display = "none"; }, 500);
    }
  }, 2500);
  window.dismissSplashWatchdog = function() { clearTimeout(splashTimer); };
})();
