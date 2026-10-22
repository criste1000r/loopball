/* Loopball on iPhone: Safari doesn't let web pages go full screen on iPhone, but a site added to the
   Home Screen opens as an app with no browser bars at all. This shows how, in a few taps. */
(function () {
  'use strict';
  var ua = navigator.userAgent || '';
  var iphone = /iPhone|iPod/.test(ua);
  var standalone = navigator.standalone === true ||
    (window.matchMedia && matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches);
  var chrome = /CriOS/.test(ua), firefox = /FxiOS/.test(ua);
  var KEY = 'lb.iosHintT';
  var open = false;

  function shareIcon() {
    return '<svg width="20" height="22" viewBox="0 0 20 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-4px"><path d="M10 15V2M5.5 6.5 10 2l4.5 4.5"/><path d="M6 10H3v12h14V10h-3"/></svg>';
  }
  function plusIcon() {
    return '<svg width="20" height="20" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" style="vertical-align:-4px"><rect x="2" y="2" width="18" height="18" rx="4"/><path d="M11 7v8M7 11h8"/></svg>';
  }
  function guide() {
    if (open) return;
    open = true;
    var step1 = chrome ? 'Tap ' + shareIcon() + ' <b>Share</b> in the address bar at the top.'
      : firefox ? 'Tap the <b>menu</b> (☰), then ' + shareIcon() + ' <b>Share</b>.'
      : 'Tap ' + shareIcon() + ' <b>Share</b> in Safari’s toolbar. If you only see <b>•••</b>, tap that first.';
    var wrap = document.createElement('div');
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Full screen on iPhone');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(6,12,22,.86);display:flex;align-items:flex-end;justify-content:center;padding:16px;padding-bottom:max(16px,env(safe-area-inset-bottom));font-family:system-ui,-apple-system,sans-serif;-webkit-user-select:none;user-select:none;touch-action:manipulation';
    wrap.innerHTML =
      '<div style="width:100%;max-width:440px;max-height:100%;overflow:auto;background:#172840;color:#f3f6f9;border:1px solid rgba(243,246,249,.18);border-radius:18px;padding:20px 20px 16px;box-shadow:0 20px 60px rgba(0,0,0,.5)">' +
      '<div style="font-weight:900;font-size:24px;letter-spacing:.02em;text-transform:uppercase;line-height:1.1">Full screen on iPhone</div>' +
      '<p style="margin:8px 0 14px;color:#b8c6d6;font-size:15px;line-height:1.45">iPhones only let games use the whole screen when they’re opened from the Home Screen. It takes ten seconds, and your name and ranks come with you.</p>' +
      '<ol style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:10px;font-size:16px;line-height:1.4">' +
      li(1, step1) +
      li(2, 'Scroll down and tap ' + plusIcon() + ' <b>Add to Home Screen</b>.') +
      li(3, 'Keep <b>Open as Web App</b> on, then tap <b>Add</b>.') +
      li(4, 'Open <b>Loopball</b> from your Home Screen. No bars, the whole screen is the game.') +
      '</ol>' +
      '<div style="display:flex;gap:10px;margin-top:18px">' +
      '<button type="button" data-x="later" style="flex:1;font:inherit;font-weight:700;font-size:16px;padding:12px;border-radius:12px;border:2px solid rgba(243,246,249,.2);background:transparent;color:#f3f6f9">Not now</button>' +
      '<button type="button" data-x="ok" style="flex:1;font:inherit;font-weight:800;font-size:16px;padding:12px;border-radius:12px;border:2px solid #3a62ff;background:#3a62ff;color:#fff">Got it</button>' +
      '</div></div>';
    function close(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      try { localStorage.setItem(KEY, String(Date.now())); } catch (x) {}
      open = false;
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }
    // keep taps on the guide from reaching the game underneath
    ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'keydown'].forEach(function (t) { wrap.addEventListener(t, function (e) { e.stopPropagation(); }); });
    wrap.addEventListener('click', function (e) {
      e.stopPropagation();
      var b = e.target.closest && e.target.closest('button');
      if (b || e.target === wrap) close(e);
    });
    document.body.appendChild(wrap);
    var ok = wrap.querySelector('[data-x="ok"]'); if (ok) ok.focus();
  }
  function li(n, html) {
    return '<li style="display:flex;gap:12px;align-items:flex-start"><span style="flex:none;width:28px;height:28px;border-radius:50%;background:#f3f6f9;color:#0e1a2b;font-weight:900;display:flex;align-items:center;justify-content:center;font-size:15px">' + n + '</span><span>' + html + '</span></li>';
  }
  // show it by itself at most once every 12 hours; the Full screen buttons show it any time
  function maybe() {
    if (!iphone || standalone) return;
    var t = 0; try { t = +localStorage.getItem(KEY) || 0; } catch (x) {}
    if (Date.now() - t < 12 * 3600 * 1000) return;
    setTimeout(guide, 600);
  }
  window.LoopIOS = { need: function () { return iphone && !standalone; }, guide: guide, maybe: maybe, standalone: standalone, iphone: iphone };
})();
