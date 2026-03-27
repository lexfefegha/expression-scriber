/**
 * Blocks the app on mobile/touch devices and shows a desktop-only message.
 * Re-evaluates on resize so DevTools device emulation is caught live.
 */
(function () {
  var app = document.getElementById('app');
  var gate = null;

  function isBlocked() {
    var mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
    var small = window.innerWidth < 900 || window.innerHeight < 500;
    var touchOnly =
      'ontouchstart' in window &&
      navigator.maxTouchPoints > 0 &&
      !window.matchMedia('(pointer: fine)').matches;
    return mobile || small || touchOnly;
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
