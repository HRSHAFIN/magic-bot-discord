(() => {
  if (window.__mbdContentLoaded) return;
  window.__mbdContentLoaded = true;

  const bot = window.MagicBotDiscord;

  function comboFromEvent(e) {
    const parts = [];
    if (e.shiftKey) parts.push('Shift');
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.metaKey) parts.push('Meta');
    let main = e.code || '';
    if (main.startsWith('Key')) main = main.slice(3);
    else if (main.startsWith('Digit')) main = main.slice(5);
    else if (main === 'Space') main = 'Space';
    if (!main) main = e.key || '?';
    parts.push(main);
    return parts.join('+');
  }

  function specFromEvent(e) {
    return {
      key: e.key,
      code: e.code || '',
      vk: e.keyCode || 0,
      modifiers: (e.shiftKey ? 8 : 0) | (e.ctrlKey ? 2 : 0) | (e.altKey ? 1 : 0) | (e.metaKey ? 4 : 0)
    };
  }

  const rec = (() => {
    let active = false;
    let steps = [];
    let lastTime = 0;
    let startedAt = 0;
    let overlay = null;
    let listeners = [];

    function tick(e) {
      if (e.repeat) return;
      if (e.code === 'Escape') return;
      const now = Date.now();
      const delay = lastTime ? now - lastTime : 0;
      lastTime = now;
      steps.push({ type: 'key', delay, spec: specFromEvent(e), combo: comboFromEvent(e) });
      updateOverlay();
    }

    function onMouseDown(e) {
      if (e.button !== 0) return;
      if (overlay && overlay.contains(e.target)) return;
      const now = Date.now();
      const delay = lastTime ? now - lastTime : 0;
      lastTime = now;
      steps.push({
        type: 'click',
        delay,
        nx: +(e.clientX / window.innerWidth).toFixed(4),
        ny: +(e.clientY / window.innerHeight).toFixed(4),
        ax: Math.round(e.clientX),
        ay: Math.round(e.clientY),
        button: e.button
      });
      updateOverlay();
    }

    function onWheel(e) {
      if (e.ctrlKey) return;
      const now = Date.now();
      const delay = lastTime ? now - lastTime : 0;
      lastTime = now;
      steps.push({
        type: 'scroll',
        delay,
        dx: Math.round(e.deltaX),
        dy: Math.round(e.deltaY)
      });
      updateOverlay();
    }

    function showOverlay() {
      if (overlay) return;
      overlay = document.createElement('div');
      overlay.id = 'mbd-rec-overlay';
      overlay.style.cssText =
        'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
        'background:#b71c1c;color:#fff;font:700 13px system-ui,sans-serif;padding:10px 16px;' +
        'border-radius:999px;cursor:pointer;box-shadow:0 2px 14px rgba(0,0,0,.6);' +
        'border:2px solid #fff;display:flex;align-items:center;gap:8px;user-select:none;';
      const dot = document.createElement('span');
      dot.style.cssText = 'width:10px;height:10px;border-radius:50%;background:#ffcdd2;display:inline-block;';
      const label = document.createElement('span');
      label.textContent = 'REC 0 actions';
      overlay.appendChild(dot);
      overlay.appendChild(label);
      overlay.addEventListener('click', (e) => {
        e.stopPropagation();
        stop();
      });
      document.body.appendChild(overlay);
    }

    function updateOverlay() {
      if (overlay) {
        const label = overlay.querySelector('span:last-child');
        if (label) label.textContent = `REC ${steps.length} action(s) - click to stop`;
      }
    }

    function hideOverlay() {
      if (overlay) {
        overlay.remove();
        overlay = null;
      }
    }

    function attach() {
      listeners = [
        ['keydown', tick],
        ['mousedown', onMouseDown],
        ['wheel', onWheel]
      ];
      for (const [name, fn] of listeners) {
        document.addEventListener(name, fn, { capture: true, passive: false });
      }
    }

    function detach() {
      for (const [name, fn] of listeners) {
        document.removeEventListener(name, fn, { capture: true, passive: false });
      }
      listeners = [];
    }

    function start() {
      if (active) return { ok: true, already: true };
      active = true;
      steps = [];
      lastTime = 0;
      startedAt = Date.now();
      attach();
      showOverlay();
      bot.setStatus('Recording... play the actions you want to repeat');
      return { ok: true };
    }

    async function stop() {
      if (!active) return { ok: true, already: true };
      active = false;
      detach();
      hideOverlay();
      const duration = Date.now() - startedAt;
      bot.saveMacro(steps);
      await bot.saveSettings();
      await bot.setStatus(`Macro saved: ${steps.length} action(s)`);
      bot.log(`recorded ${steps.length} action(s) in ${(duration / 1000).toFixed(1)}s`);
      return {
        ok: true,
        count: steps.length,
        duration,
        preview: steps.slice(0, 25).map((x) => (x.type === 'key' ? x.combo : `${x.type}${x.type === 'click' ? `@${x.nx},${x.ny}` : ''}`)).join(' ')
      };
    }

    async function clear() {
      bot.saveMacro([]);
      await bot.saveSettings();
      return { ok: true };
    }

    return {
      start,
      stop,
      clear,
      get active() { return active; },
      get count() { return steps.length; }
    };
  })();

  function formatStepText(step) {
    if (step.type === 'key') return `${step.delay || 0}  ${step.combo || '?'}`;
    if (step.type === 'click') return `${step.delay || 0}  click ${step.nx} ${step.ny}`;
    if (step.type === 'scroll') return `${step.delay || 0}  scroll ${step.dx || 0} ${step.dy || 0}`;
    return '';
  }

  function parseStepText(line) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 2) return null;
    const delay = Math.max(0, parseInt(tokens[0], 10) || 0);
    const kind = tokens[1].toLowerCase();
    if (kind === 'click') {
      const nx = parseFloat(tokens[2]);
      const ny = parseFloat(tokens[3]);
      if (!isFinite(nx) || !isFinite(ny)) return null;
      return {
        type: 'click',
        delay,
        nx: Math.max(0, Math.min(1, nx)),
        ny: Math.max(0, Math.min(1, ny)),
        ax: Math.round(nx * window.innerWidth),
        ay: Math.round(ny * window.innerHeight),
        button: 0
      };
    }
    if (kind === 'scroll') {
      const dx = parseInt(tokens[2], 10) || 0;
      const dy = parseInt(tokens[3], 10) || 0;
      return { type: 'scroll', delay, dx, dy };
    }
    const combo = tokens.slice(1).join('+');
    const spec = bot.parseCombo(combo);
    if (!spec) return null;
    return { type: 'key', delay, spec, combo };
  }

  function collectDiag() {
    const tags = {};
    document.querySelectorAll('body *').forEach((el) => {
      const t = el.tagName.toLowerCase();
      tags[t] = (tags[t] || 0) + 1;
    });
    return {
      url: location.href,
      title: document.title,
      viewport: window.innerWidth + 'x' + window.innerHeight,
      botLoaded: !!window.MagicBotDiscord,
      elementCount: document.querySelectorAll('body *').length,
      tags,
      iframes: document.querySelectorAll('iframe').length,
      activeElement: document.activeElement ? document.activeElement.tagName + (document.activeElement.id ? '#' + document.activeElement.id : '') : 'none'
    };
  }

  function onMessage(msg, sender, sendResponse) {
    if (!msg || typeof msg.type !== 'string') return;
    switch (msg.type) {
      case 'ping':
        sendResponse && sendResponse({ ok: true, url: location.href });
        break;
      case 'record:start': {
        (async () => {
          if (bot.isRunning()) await bot.stop();
          sendResponse && sendResponse(rec.start());
        })();
        break;
      }
      case 'record:stop':
        rec.stop().then((r) => sendResponse && sendResponse(r));
        break;
      case 'record:clear':
        rec.clear().then((r) => sendResponse && sendResponse(r));
        break;
      case 'record:status':
        sendResponse && sendResponse({ ok: true, active: rec.active, count: rec.count });
        break;
      case 'play:start':
        bot.start();
        sendResponse && sendResponse({ ok: true, running: bot.isRunning() });
        break;
      case 'play:stop':
        bot.stop().then(() => sendResponse && sendResponse({ ok: true, running: false }));
        break;
      case 'play:status':
        sendResponse && sendResponse({ ok: true, running: bot.isRunning(), loop: bot.currentLoop() });
        break;
      case 'key:test':
        bot.pressKey(msg.key || 'Space').then((ok) =>
          sendResponse && sendResponse({ ok, key: msg.key || 'Space', parsed: bot.parseCombo(msg.key || 'Space') })
        );
        break;
      case 'diag:collect':
        sendResponse && sendResponse({ ok: true, diag: collectDiag() });
        break;
      case 'macro:list':
        sendResponse && sendResponse({ ok: true, macros: bot.listMacros(), activeId: bot.getSettings().activeMacroId });
        break;
      case 'macro:select': {
        const ok = bot.setActiveMacro(msg.id);
        if (ok) bot.saveSettings();
        sendResponse && sendResponse({ ok, activeId: bot.getSettings().activeMacroId });
        break;
      }
      case 'macro:create': {
        const m = bot.createMacro(msg.name);
        bot.saveSettings();
        sendResponse && sendResponse({ ok: true, id: m.id, name: m.name });
        break;
      }
      case 'macro:rename': {
        const ok = bot.renameMacro(msg.id, msg.name);
        if (ok) bot.saveSettings();
        sendResponse && sendResponse({ ok });
        break;
      }
      case 'macro:delete': {
        const ok = bot.deleteMacro(msg.id);
        if (ok) bot.saveSettings();
        sendResponse && sendResponse({ ok });
        break;
      }
      case 'macro:edit': {
        const lines = Array.isArray(msg.lines) ? msg.lines : [];
        const steps = [];
        let bad = 0;
        for (const line of lines) {
          const step = parseStepText(line);
          if (!step) {
            bad++;
            continue;
          }
          steps.push(step);
        }
        if (!steps.length) {
          sendResponse && sendResponse({ ok: false, reason: 'no valid lines' });
          break;
        }
        bot.saveMacro(steps);
        bot.saveSettings();
        sendResponse && sendResponse({ ok: true, count: steps.length, skipped: bad });
        break;
      }
      default:
        sendResponse && sendResponse({ ok: false, reason: 'unknown type: ' + msg.type });
        break;
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    onMessage(msg, sender, sendResponse);
    return true;
  });

  bot.loadSettings().then(() => {
    const s = bot.getSettings();
    if (s.enabled) {
      s.enabled = false;
      bot.saveSettings();
    }
  });
})();
