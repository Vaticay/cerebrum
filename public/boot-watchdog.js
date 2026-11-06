/* Boot watchdog for the static layer (2026-11-06, cold demo fix).
 *
 * Before the app bundle arrives, the page is a static layer: the
 * boot splash in the app shell (index.html), or the prerendered
 * title card on the door route (scripts/prerender.mjs stamps the
 * same marker there). Both carry id "cb-boot". If the bundle never
 * loads or never runs (a phone connection dropping mid load is the
 * recorded case), that layer used to be the whole product: on the
 * shell a silent animated drawing with no words, no retry, and no
 * timeout, and on the door a card whose only way forward reloads
 * into the same stall.
 *
 * This script is the failure exit. It waits BOOT_WATCHDOG_MS for
 * the app to mount, then, if the static layer is still on the page,
 * replaces it with plain words: the app did not load, the
 * connection may have dropped, and a Reload button. Mounting
 * stands the watchdog down two ways: src/main.jsx sets
 * window.__cbAppMounted the moment the bundle executes, and React
 * replaces the layer itself, marker included. A MutationObserver
 * watches for either, so the stand down is immediate, not at the
 * deadline. A bundle that arrives after the failure words still
 * wins: createRoot renders over whatever the root holds.
 *
 * The window is 15 seconds. The shell's own draw settles in about
 * 1.6 seconds, and the site answers a full production search in
 * about 10 seconds end to end; a bundle that has not mounted 15
 * seconds after the shell parsed is not a slow boot, it is a
 * failed one.
 *
 * Plain classic script, no imports, no inline handlers: the CSP
 * serves script-src 'self' with no unsafe-inline, and this file
 * is that self. The DOM surface it touches is deliberately narrow
 * (getElementById, createElement, textContent, appendChild,
 * addEventListener) so the regression harness can stub it exactly.
 */
(function () {
  var BOOT_WATCHDOG_MS = 15000;

  var root = document.getElementById("root");
  if (!root) return;
  // Pages whose root holds a complete static document (the
  // prerendered info pages) carry no boot marker: they stand on
  // their own without the bundle, and the watchdog never arms.
  if (!document.getElementById("cb-boot")) return;

  var settled = false;
  var timer = null;
  var observer = null;

  function standDown() {
    if (settled) return;
    settled = true;
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (observer) { observer.disconnect(); observer = null; }
  }

  function appMounted() {
    return !!window.__cbAppMounted || !document.getElementById("cb-boot");
  }

  function showFailure() {
    if (settled) return;
    if (appMounted()) { standDown(); return; }
    settled = true;
    if (observer) { observer.disconnect(); observer = null; }

    var wrap = document.createElement("div");
    wrap.setAttribute("role", "alert");
    wrap.style.cssText = "min-height:100dvh;display:flex;align-items:center;justify-content:center;background:#060606;color:#f3f3f1;padding:24px;text-align:center;font-family:'Inter Tight','Inter',ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";

    var inner = document.createElement("div");
    inner.style.cssText = "max-width:460px;";

    var title = document.createElement("div");
    title.textContent = "Cerebrum did not load";
    title.style.cssText = "font-size:22px;font-weight:500;margin-bottom:10px;";

    var body = document.createElement("p");
    body.textContent = "The app did not start. Your connection may have dropped while it was loading. Check the connection, then try again.";
    body.style.cssText = "font-size:15px;line-height:1.55;color:rgba(243,243,241,0.72);margin:0 0 22px;";

    var button = document.createElement("button");
    button.setAttribute("type", "button");
    button.textContent = "Reload";
    button.style.cssText = "padding:10px 20px;border-radius:2px;border:none;cursor:pointer;background:#f3f3f1;color:#060606;font-weight:500;font-size:14px;font-family:inherit;";
    button.addEventListener("click", function () { window.location.reload(); });

    inner.appendChild(title);
    inner.appendChild(body);
    inner.appendChild(button);
    wrap.appendChild(inner);

    root.textContent = "";
    root.appendChild(wrap);
  }

  if (typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(function () {
      if (appMounted()) standDown();
    });
    observer.observe(root, { childList: true, subtree: true });
  }
  timer = setTimeout(showFailure, BOOT_WATCHDOG_MS);
})();
