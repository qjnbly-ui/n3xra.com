(function () {
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (isStandalone) {
    document.documentElement.classList.add("app-standalone");
  }

  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/service-worker.js").catch(function () {
      // Ignore registration failures in unsupported/local environments.
    });
  });
})();
