(() => {
  if (window.MagicBotDiscord) return;

  const DEFAULT_SETTINGS = {
    version: 1,
    enabled: false,
    coordsMode: 'normalized',
    loopCount: 0,
    repeatMin: 2000,
    repeatMax: 6000,
    speed: 1,
    trustedInput: true,
    macros: [],
    activeMacroId: null,
    macroDuration: 0
  };

  const state = {
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    running: false,
    stopped: false,
    loop: 0
  };

  function getStorageArea() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return chrome.storage.local;
    }
    return {
      get: (keys) =>
        Promise.resolve(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((k) => [k, null]))),
      set: () => Promise.resolve()
    };
  }

  async function loadSettings() {
    const area = getStorageArea();
    const stored = await area.get('mbd');
    const saved = (stored && stored.mbd) || {};
    state.settings = deepMerge(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), saved);
    return state.settings;
  }

  async function saveSettings() {
    const area = getStorageArea();
    await area.set({ mbd: state.settings });
  }

  function deepMerge(base, extra) {
    const out = Array.isArray(base) ? base.slice() : { ...base };
    for (const key of Object.keys(extra || {})) {
      const a = base ? base[key] : undefined;
      const b = extra[key];
      if (b && typeof b === 'object' && !Array.isArray(b)) {
        out[key] = deepMerge(a && typeof a === 'object' ? a : {}, b);
      } else if (b !== undefined) {
        out[key] = b;
      }
    }
    return out;
  }

  function rand(min, max) {
    return Math.floor(min + Math.random() * (max - min));
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function post(type, payload) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        chrome.runtime.sendMessage({ type, payload });
      } catch (e) {}
    }
  }

  function log(msg, kind) {
    const line = {
      t: Date.now(),
      msg: String(msg),
      kind: kind || '',
      ts: new Date().toLocaleTimeString()
    };
    getStorageArea()
      .get('mbdlog')
      .then((stored) => {
        const list = (stored && stored.mbdlog) || [];
        list.push(line);
        while (list.length > 300) list.shift();
        return getStorageArea().set({ mbdlog: list });
      })
      .catch(() => {});
    post('log', line);
  }

  async function setStatus(text, extra) {
    await getStorageArea().set({ mbdstatus: { text, at: Date.now(), ...(extra || {}) } });
    post('status', { text, at: Date.now() });
  }

  function cdpCmd(cmd, payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'cmd', payload: { cmd, ...payload } }).then(
          (resp) => resolve(resp && typeof resp === 'object' ? resp : { ok: false }),
          () => resolve({ ok: false })
        );
      } catch (e) {
        resolve({ ok: false });
      }
    });
  }

  async function cdpAttach() {
    return cdpCmd('cdp:attach', {});
  }

  async function cdpDetach() {
    return cdpCmd('cdp:detach', {});
  }

  const KEYMAP = {
    Space: { key: ' ', code: 'Space', vk: 32 },
    Enter: { key: 'Enter', code: 'Enter', vk: 13 },
    Escape: { key: 'Escape', code: 'Escape', vk: 27 },
    Tab: { key: 'Tab', code: 'Tab', vk: 9 },
    Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
    Delete: { key: 'Delete', code: 'Delete', vk: 46 },
    ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
    ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
    ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
    ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
    Home: { key: 'Home', code: 'Home', vk: 36 },
    End: { key: 'End', code: 'End', vk: 35 },
    PageUp: { key: 'PageUp', code: 'PageUp', vk: 33 },
    PageDown: { key: 'PageDown', code: 'PageDown', vk: 34 }
  };

  const SHIFTED_DIGITS = { '1': '!', '2': '@', '3': '#', '4': '$', '5': '%', '6': '^', '7': '&', '8': '*', '9': '(', '0': ')' };

  const MODIFIER_KEYS = {
    Shift: { key: 'Shift', code: 'ShiftLeft', vk: 16 },
    ShiftLeft: { key: 'Shift', code: 'ShiftLeft', vk: 16 },
    ShiftRight: { key: 'Shift', code: 'ShiftRight', vk: 16 },
    Ctrl: { key: 'Control', code: 'ControlLeft', vk: 17 },
    Control: { key: 'Control', code: 'ControlLeft', vk: 17 },
    ControlLeft: { key: 'Control', code: 'ControlLeft', vk: 17 },
    ControlRight: { key: 'Control', code: 'ControlRight', vk: 17 },
    Alt: { key: 'Alt', code: 'AltLeft', vk: 18 },
    AltLeft: { key: 'Alt', code: 'AltLeft', vk: 18 },
    AltRight: { key: 'Alt', code: 'AltRight', vk: 18 },
    Meta: { key: 'Meta', code: 'MetaLeft', vk: 91 },
    MetaLeft: { key: 'Meta', code: 'MetaLeft', vk: 91 },
    MetaRight: { key: 'Meta', code: 'MetaRight', vk: 91 }
  };

  function parseCombo(combo) {
    const parts = String(combo).split('+').map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return null;
    let modifiers = 0;
    for (const p of parts.slice(0, -1)) {
      const up = p.toUpperCase();
      if (up === 'SHIFT') modifiers |= 8;
      else if (up === 'CTRL' || up === 'CONTROL') modifiers |= 2;
      else if (up === 'ALT') modifiers |= 1;
      else if (up === 'META' || up === 'CMD') modifiers |= 4;
    }
    const main = parts[parts.length - 1];
    if (KEYMAP[main]) return { ...KEYMAP[main], modifiers };
    if (MODIFIER_KEYS[main]) return { ...MODIFIER_KEYS[main], modifiers };
    if (/^[0-9]$/.test(main)) {
      return {
        key: modifiers & 8 ? (SHIFTED_DIGITS[main] || main) : main,
        code: 'Digit' + main,
        vk: 48 + parseInt(main, 10),
        modifiers
      };
    }
    if (/^[a-zA-Z]$/.test(main)) {
      return {
        key: modifiers & 8 ? main.toUpperCase() : main.toLowerCase(),
        code: 'Key' + main.toUpperCase(),
        vk: main.toUpperCase().charCodeAt(0),
        modifiers
      };
    }
    return null;
  }

  function syntheticKey(spec) {
    const opts = {
      bubbles: true,
      cancelable: true,
      composed: true,
      key: spec.key,
      code: spec.code,
      keyCode: spec.vk,
      which: spec.vk,
      shiftKey: !!(spec.modifiers & 8),
      ctrlKey: !!(spec.modifiers & 2),
      altKey: !!(spec.modifiers & 1),
      metaKey: !!(spec.modifiers & 4)
    };
    try {
      const t = document.activeElement || document.body || window;
      t.dispatchEvent(new KeyboardEvent('keydown', opts));
      t.dispatchEvent(new KeyboardEvent('keyup', opts));
    } catch (e) {}
  }

  function fire(x, y) {
    const opts = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: 1,
      view: window,
      pointerId: 1,
      isPrimary: true,
      pointerType: 'mouse'
    };
    const el = document.elementFromPoint(x, y) || document.body;
    const MouseEventCtor = window.MouseEvent;
    const PointerEventCtor = window.PointerEvent;
    if (PointerEventCtor) {
      el.dispatchEvent(new PointerEvent('pointerover', opts));
      el.dispatchEvent(new PointerEvent('pointerenter', { ...opts, bubbles: false }));
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
    }
    if (MouseEventCtor) {
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new MouseEvent('mouseover', opts));
    }
    if (PointerEventCtor) {
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new PointerEvent('pointerout', opts));
      el.dispatchEvent(new PointerEvent('pointerleave', { ...opts, bubbles: false }));
    }
    if (MouseEventCtor) {
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
    }
  }

  async function pressKeySpec(spec) {
    if (!spec || !spec.code) return false;
    if (!state.settings.trustedInput) {
      syntheticKey(spec);
      return true;
    }
    const resp = await cdpCmd('cdp:key', { spec });
    if (resp && resp.ok) return true;
    log('cdp key failed - using synthetic fallback', 'warn');
    syntheticKey(spec);
    return true;
  }

  async function pressKey(combo) {
    const spec = parseCombo(combo);
    if (!spec) {
      log(`bad key combo: ${combo}`, 'err');
      return false;
    }
    return pressKeySpec(spec);
  }

  function stepPoint(step) {
    let x, y;
    if (state.settings.coordsMode === 'absolute') {
      x = typeof step.ax === 'number' ? step.ax : step.nx * window.innerWidth;
      y = typeof step.ay === 'number' ? step.ay : step.ny * window.innerHeight;
    } else {
      x = (typeof step.nx === 'number' ? step.nx : step.ax / window.innerWidth) * window.innerWidth;
      y = (typeof step.ny === 'number' ? step.ny : step.ay / window.innerHeight) * window.innerHeight;
    }
    return { x: Math.round(x), y: Math.round(y) };
  }

  async function clickStep(step) {
    const pt = stepPoint(step);
    if (!state.settings.trustedInput) {
      fire(pt.x, pt.y);
      return true;
    }
    const resp = await cdpCmd('cdp:click', pt);
    if (resp && resp.ok) return true;
    log(`cdp click at ${pt.x},${pt.y} failed - synthetic fallback`, 'warn');
    fire(pt.x, pt.y);
    return true;
  }

  async function scrollStep(step) {
    const dx = step.dx || 0;
    const dy = step.dy || 0;
    if (state.settings.trustedInput) {
      const resp = await cdpCmd('cdp:scroll', {
        x: Math.round(window.innerWidth / 2),
        y: Math.round(window.innerHeight / 2),
        dx,
        dy
      });
      if (resp && resp.ok) return true;
      log('cdp scroll failed - synthetic fallback', 'warn');
    }
    window.scrollBy(dx, dy);
    return true;
  }

  async function playStep(step) {
    if (!step) return true;
    switch (step.type) {
      case 'key':
        return pressKeySpec(step.spec);
      case 'click':
        return clickStep(step);
      case 'scroll':
        return scrollStep(step);
      default:
        return true;
    }
  }

  async function playMacro() {
    const macro = getActiveMacro();
    if (!macro.length) {
      log('macro is empty - record one first', 'warn');
      return;
    }
    const speed = Math.min(3, Math.max(0.3, parseFloat(state.settings.speed) || 1));
    let n = 0;
    for (const step of macro) {
      if (!state.running || state.stopped) break;
      await sleep(Math.round(((step && step.delay) || 0) * speed));
      if (step && step.type) {
        await playStep(step);
        n++;
      }
    }
    log(`macro played: ${n} action(s)`);
  }

  async function runLoop() {
    state.loop = 0;
    state.stopped = false;
    state.running = true;
    await setStatus('Bot running');
    const loops = Math.max(0, parseInt(state.settings.loopCount, 10) || 0);
    while (state.running && !state.stopped && (loops === 0 || state.loop < loops)) {
      state.loop++;
      await setStatus(`Loop ${state.loop} - playing`);
      await playMacro();
      if (state.running && !state.stopped && (loops === 0 || state.loop < loops)) {
        await setStatus(`Loop ${state.loop} done - waiting`);
        await sleep(rand(state.settings.repeatMin, state.settings.repeatMax));
      }
    }
    state.running = false;
    if (state.stopped) {
      await setStatus('Bot stopped');
    } else if (loops) {
      await setStatus(`Finished ${state.loop} loops`);
    } else {
      await setStatus('Bot stopped');
    }
  }

  async function start() {
    if (state.running) return;
    await loadSettings();
    state.running = true;
    state.stopped = false;
    if (state.settings.trustedInput) await cdpAttach();
    runLoop();
  }

  async function stop() {
    state.stopped = true;
    state.running = false;
    if (state.settings.trustedInput) await cdpDetach();
  }

  function getActiveMacro() {
    const s = state.settings;
    if (Array.isArray(s.macros) && s.macros.length) {
      const m = s.macros.find((x) => x.id === s.activeMacroId) || s.macros[0];
      if (m && Array.isArray(m.steps)) return m.steps;
    }
    return [];
  }

  function listMacros() {
    const s = state.settings;
    const list = Array.isArray(s.macros) ? s.macros : [];
    return list.map((m) => ({
      id: m.id,
      name: m.name || 'Macro',
      count: Array.isArray(m.steps) ? m.steps.length : 0
    }));
  }

  function setActiveMacro(id) {
    const s = state.settings;
    if (!Array.isArray(s.macros)) return false;
    const m = s.macros.find((x) => x.id === id);
    if (!m) return false;
    s.activeMacroId = id;
    s.macroDuration = m.duration || 0;
    return true;
  }

  function createMacro(name) {
    const s = state.settings;
    if (!Array.isArray(s.macros)) s.macros = [];
    const m = {
      id: 'm' + Date.now() + Math.floor(Math.random() * 1000),
      name: name || 'Macro ' + (s.macros.length + 1),
      steps: [],
      duration: 0
    };
    s.macros.push(m);
    s.activeMacroId = m.id;
    s.macroDuration = 0;
    return m;
  }

  function renameMacro(id, name) {
    const s = state.settings;
    if (!Array.isArray(s.macros)) return false;
    const m = s.macros.find((x) => x.id === id);
    if (!m) return false;
    m.name = name || m.name;
    return true;
  }

  function deleteMacro(id) {
    const s = state.settings;
    if (!Array.isArray(s.macros)) return false;
    const idx = s.macros.findIndex((m) => m.id === id);
    if (idx === -1) return false;
    s.macros.splice(idx, 1);
    if (s.activeMacroId === id) {
      const next = s.macros[Math.min(idx, s.macros.length - 1)];
      s.activeMacroId = next ? next.id : null;
    }
    const m = s.macros.find((x) => x.id === s.activeMacroId);
    s.macroDuration = m ? m.duration : 0;
    return true;
  }

  function saveMacro(steps, name) {
    const s = state.settings;
    if (!Array.isArray(s.macros)) s.macros = [];
    let m = null;
    if (s.activeMacroId) m = s.macros.find((x) => x.id === s.activeMacroId);
    if (!m) m = s.macros[0];
    if (!m) {
      m = { id: 'm' + Date.now() + Math.floor(Math.random() * 1000), name: name || 'Macro 1', steps: [], duration: 0 };
      s.macros.push(m);
    }
    s.activeMacroId = m.id;
    if (name && name !== m.name) m.name = name;
    m.steps = Array.isArray(steps) ? steps : [];
    m.duration = m.steps.reduce((a, b) => a + ((b && b.delay) || 0), 0);
    s.macroDuration = m.duration;
    return m;
  }

  window.MagicBotDiscord = {
    loadSettings,
    saveSettings,
    start,
    stop,
    pressKey,
    pressKeySpec,
    parseCombo,
    clickStep,
    scrollStep,
    getSettings: () => state.settings,
    isRunning: () => state.running,
    currentLoop: () => state.loop,
    log,
    setStatus,
    getActiveMacro,
    listMacros,
    setActiveMacro,
    createMacro,
    renameMacro,
    deleteMacro,
    saveMacro
  };
})();
