/**
 * Blocks the app on mobile/touch devices and shows a desktop-only message.
 * Re-evaluates on resize so DevTools device emulation is caught live.
 */
(function () {
  var app = document.getElementById('app');
  var gate = null;

  function isBlocked() {
    var ua = navigator.userAgent || '';
    var platform = navigator.platform || '';
    var maxTP = navigator.maxTouchPoints || 0;

    // UA-based mobile detection (covers most phones)
    var mobileUA = /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|CriOS|FxiOS/i.test(ua);

    // iPad detection: iPadOS 13+ disguises itself as Mac in the UA string,
    // but exposes touch points and a Macintosh platform
    var iPad = /Macintosh/i.test(ua) && maxTP > 1;
    // Also catch older iPads that still include "iPad" in the UA
    iPad = iPad || /iPad/i.test(ua);

    // Viewport too small for the experience
    var small = window.innerWidth < 900 || window.innerHeight < 500;

    // Primary input is touch (coarse pointer) — catches devices the UA check misses.
    // pointer:coarse is the most reliable signal for "no mouse attached".
    var coarseOnly = window.matchMedia('(pointer: coarse)').matches &&
                     !window.matchMedia('(any-pointer: fine)').matches;

    return mobileUA || iPad || small || coarseOnly;
  }

  function createGate() {
    var el = document.createElement('div');
    el.id = 'device-gate';
    el.innerHTML =
      '<div class="gate-icon">⊹</div>' +
      '<h1>Desktop Only</h1>' +
      '<p>Expression-Scriber uses your webcam and body tracking in ways that need a bigger screen and a keyboard.</p>' +
      '<p>Please visit on a desktop or laptop computer.</p>';
    return el;
  }

  function check() {
    if (isBlocked()) {
      if (!gate) {
        gate = createGate();
        document.body.appendChild(gate);
      }
      app.style.display = 'none';
      gate.style.display = '';
    } else {
      if (gate) gate.style.display = 'none';
      app.style.display = '';
    }
  }

  check();
  window.addEventListener('resize', check);
})();
