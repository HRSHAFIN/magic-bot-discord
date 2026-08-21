(() => {
  const $ = (id) => document.getElementById(id);

  const defaults = {
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

  let settings = { ...defaults };
  let status = { text: 'idle' };
  let log = [];
  let running = false;
  let recording = false;
  let tabs = [];
  let targetTabId = null;
  let macroTextDirty = false;
  let refreshing = false;
  let lastTabsLoad = 0;

  function cmd(payload) {
    return chrome.runtime.sendMessage({ type: 'cmd', payload }).catch(() => ({ ok: false }));
  }

  function readStorage() {
    return chrome.storage.local.get(['mbd', 'mbdstatus', 'mbdlog', 'mbdtarget']);
  }

  function setDot() {
    const dot = $('statusDot');
    dot.classList.remove('running', 'idle', 'stopped', 'recording');
    if (running) dot.classList.add('running');
    else if (recording) dot.classList.add('running');
    else if (status.text && status.text !== 'Bot stopped' && status.text !== 'Macro saved') dot.classList.add('idle');
    else dot.classList.add('stopped');
  }

  function renderStatus() {
    $('statusLine').textContent = status.text || 'idle';
    setDot();
  }

  function renderLog() {
    const box = $('log');
    box.innerHTML = '';
    for (const line of log.slice(-200)) {
      const div = document.createElement('div');
      div.textContent = line.ts + '  ' + line.msg;
      if (line.kind === 'err') div.classList.add('err');
      else if (line.kind === 'warn') div.classList.add('warn');
      box.appendChild(div);
    }
    box.scrollTop = box.scrollHeight;
  }

  function setValue(id, value) {
    const el = $(id);
    if (document.activeElement !== el) el.value = value;
  }

  function activeMacro() {
    const list = Array.isArray(settings.macros) ? settings.macros : [];
    const m = list.find((x) => x.id === settings.activeMacroId) || list[0] || null;
    return m;
  }

  function renderMacroSelect() {
    const sel = $('macroSelect');
    const list = Array.isArray(settings.macros) ? settings.macros : [];
    const active = activeMacro();
    sel.innerHTML = '';
    if (!list.length) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = 'No macros - record or create one';
      sel.appendChild(o);
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    for (const m of list) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = `${m.name || 'Macro'} (${Array.isArray(m.steps) ? m.steps.length : 0} actions)`;
      if (active && m.id === active.id) o.selected = true;
      sel.appendChild(o);
    }
  }

  function renderSettings() {
    $('trustedInput').checked = settings.trustedInput !== false;
    $('coordsMode').value = settings.coordsMode === 'absolute' ? 'absolute' : 'normalized';
    setValue('loopCount', settings.loopCount || 0);
    setValue('repeatMin', settings.repeatMin || 2000);
    setValue('repeatMax', settings.repeatMax || 6000);
    setValue('speed', settings.speed || 1);
    const m = activeMacro();
    const steps = (m && Array.isArray(m.steps)) ? m.steps : [];
    $('macroInfo').textContent = (m ? `${m.name}: ` : '') + (steps.length
      ? `${steps.length} actions, ${((m.duration || 0) / 1000).toFixed(1)}s\n` + steps.slice(0, 10).map(formatStep).join(' ')
      : 'No macro recorded yet.');
    if (!macroTextDirty) {
      setValue('macroText', steps.length ? steps.map(formatStep).join('\n') : '');
    }
  }

  function formatStep(s) {
    if (s.type === 'key') return `${s.delay || 0}  ${s.combo || '?'}`;
    if (s.type === 'click') return `${s.delay || 0}  click ${s.nx} ${s.ny}`;
    if (s.type === 'scroll') return `${s.delay || 0}  scroll ${s.dx || 0} ${s.dy || 0}`;
    return '';
  }

  function renderTabSelect() {
    const sel = $('tabSelect');
    const prev = sel.value;
    sel.innerHTML = '';
    if (!tabs.length) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = 'no tabs found';
      sel.appendChild(o);
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    for (const t of tabs) {
      const o = document.createElement('option');
      o.value = String(t.id);
      let label = '';
      if (t.url) {
        try {
          label = new URL(t.url).hostname.replace(/^www\./, '') + ' - ';
        } catch (e) {}
      }
      label += (t.title || 'untitled').slice(0, 40);
      if (t.active) label = '* ' + label;
      o.textContent = label;
      o.title = t.url || '';
      if (t.id === targetTabId) o.selected = true;
      sel.appendChild(o);
    }
    if (prev && sel.value === '') {
      sel.value = '';
    }
  }

  function renderButtons() {
    $('recordBtn').disabled = running || recording;
    $('stopRecBtn').disabled = !recording;
    $('playBtn').disabled = recording;
    $('stopBtn').disabled = !running;
  }

  function renderTabs() {
    const info = $('tabInfo');
    const t = tabs.find((x) => x.id === targetTabId);
    if (t) {
      info.textContent = `Target: ${t.url || 'no url'}`;
    } else if (tabs.length) {
      info.textContent = 'Pick the tab where you want to record / play.';
    }
  }

  function render() {
    renderStatus();
    renderLog();
    renderSettings();
    renderMacroSelect();
    renderTabSelect();
    renderTabs();
    renderButtons();
  }

  async function loadTabs() {
    lastTabsLoad = Date.now();
    try {
      tabs = await chrome.tabs.query({});
    } catch (e) {
      tabs = [];
    }
    const hasTarget = tabs.some((t) => t.id === targetTabId);
    if (!hasTarget) {
      const activeTab = tabs.find((t) => t.active && t.id !== chrome.tabs.TAB_ID_NONE) || tabs[0] || null;
      if (activeTab) {
        targetTabId = activeTab.id;
        cmd({ cmd: 'tab:set', tabId: activeTab.id });
      }
    }
    renderTabSelect();
    renderTabs();
  }

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      const data = await readStorage();
      if (data.mbd) settings = { ...defaults, ...data.mbd };
      if (data.mbdstatus) status = data.mbdstatus;
      if (Array.isArray(data.mbdlog)) log = data.mbdlog;
      if (data.mbdtarget && data.mbdtarget.tabId) targetTabId = data.mbdtarget.tabId;
      running = !!(settings && settings.enabled);
      const tabStatus = await cmd({ cmd: 'toTab', type: 'play:status' });
      if (tabStatus && tabStatus.running) running = true;
      const recStatus = await cmd({ cmd: 'toTab', type: 'record:status' });
      if (recStatus && recStatus.active) recording = true;
      if (Date.now() - lastTabsLoad > 4000) await loadTabs();
      render();
    } finally {
      refreshing = false;
    }
  }

  async function saveSettings() {
    const repeatMin = Math.max(0, parseInt($('repeatMin').value, 10) || 2000);
    const repeatMax = Math.max(repeatMin + 100, parseInt($('repeatMax').value, 10) || 6000);
    settings = {
      ...settings,
      enabled: running,
      trustedInput: $('trustedInput').checked,
      coordsMode: $('coordsMode').value === 'absolute' ? 'absolute' : 'normalized',
      loopCount: Math.max(0, parseInt($('loopCount').value, 10) || 0),
      repeatMin,
      repeatMax,
      speed: Math.min(3, Math.max(0.3, parseFloat($('speed').value) || 1))
    };
    await chrome.storage.local.set({ mbd: settings });
    status = { text: 'settings saved', at: Date.now() };
    render();
  }

  $('recordBtn').addEventListener('click', async () => {
    await saveSettings();
    $('statusLine').textContent = 'recording...';
    const res = await cmd({ cmd: 'toTab', type: 'record:start' });
    setTimeout(refresh, 500);
    if (res && res.ok && !res.already) {
      $('statusLine').textContent = 'RECORDING - do your actions in the target tab, then click Stop & save';
    } else if (res && res.ok) {
      $('statusLine').textContent = 'already recording';
    } else {
      $('statusLine').textContent = 'could not reach target tab (' + (res.reason || '?') + ')';
    }
  });

  $('stopRecBtn').addEventListener('click', async () => {
    $('statusLine').textContent = 'saving macro...';
    const res = await cmd({ cmd: 'toTab', type: 'record:stop' });
    if (res && res.ok && typeof res.count === 'number') {
      macroTextDirty = false;
      $('statusLine').textContent = `macro saved (${res.count} actions)`;
      $('macroInfo').textContent = `Saved ${res.count} actions in ${((res.duration || 0) / 1000).toFixed(1)}s.\n` + (res.preview || '').slice(0, 160);
    } else {
      $('statusLine').textContent = 'not recording';
    }
    setTimeout(refresh, 400);
  });

  $('playBtn').addEventListener('click', async () => {
    await saveSettings();
    $('statusLine').textContent = 'contacting tab...';
    const res = await cmd({ cmd: 'toTab', type: 'play:start', ensureActive: true });
    setTimeout(refresh, 700);
    if (!res.ok) $('statusLine').textContent = 'could not reach target tab (' + (res.reason || '?') + ')';
  });

  $('stopBtn').addEventListener('click', async () => {
    await cmd({ cmd: 'toTab', type: 'play:stop' });
    setTimeout(refresh, 400);
  });

  $('testBtn').addEventListener('click', async () => {
    await saveSettings();
    $('statusLine').textContent = 'pressing Space on target tab...';
    const res = await cmd({ cmd: 'toTab', type: 'key:test', key: 'Space' });
    if (res && res.ok) $('statusLine').textContent = 'tested Space (trusted input works)';
    else $('statusLine').textContent = 'could not reach target tab';
  });

  $('clearBtn').addEventListener('click', async () => {
    await cmd({ cmd: 'toTab', type: 'record:clear' });
    setTimeout(refresh, 400);
  });

  $('saveBtn').addEventListener('click', saveSettings);

  $('clearLogBtn').addEventListener('click', async () => {
    await chrome.storage.local.set({ mbdlog: [] });
    log = [];
    renderLog();
  });

  $('tabSelect').addEventListener('change', async () => {
    const id = parseInt($('tabSelect').value, 10);
    if (!id) return;
    targetTabId = id;
    await cmd({ cmd: 'tab:set', tabId: id });
    renderTabs();
  });

  $('tabRefresh').addEventListener('click', async () => {
    await loadTabs();
  });

  $('macroSelect').addEventListener('change', async () => {
    const id = $('macroSelect').value;
    if (!id) return;
    macroTextDirty = false;
    await cmd({ cmd: 'toTab', type: 'macro:select', id });
    setTimeout(refresh, 400);
  });

  $('macroNew').addEventListener('click', async () => {
    const name = window.prompt('Macro name:', 'Macro ' + (Array.isArray(settings.macros) ? settings.macros.length + 1 : 1));
    if (name === null) return;
    macroTextDirty = false;
    await cmd({ cmd: 'toTab', type: 'macro:create', name: name.trim() || 'Macro' });
    setTimeout(refresh, 400);
  });

  $('macroRename').addEventListener('click', async () => {
    const m = activeMacro();
    if (!m) return;
    const name = window.prompt('New name for macro:', m.name);
    if (name === null || !name.trim()) return;
    await cmd({ cmd: 'toTab', type: 'macro:rename', id: m.id, name: name.trim() });
    setTimeout(refresh, 400);
  });

  $('macroDelete').addEventListener('click', async () => {
    const m = activeMacro();
    if (!m) return;
    if (!window.confirm(`Delete macro "${m.name}"?`)) return;
    macroTextDirty = false;
    await cmd({ cmd: 'toTab', type: 'macro:delete', id: m.id });
    setTimeout(refresh, 400);
  });

  $('macroText').addEventListener('input', () => {
    macroTextDirty = true;
  });

  $('macroSaveEdit').addEventListener('click', async () => {
    const lines = $('macroText').value.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) {
      $('macroEditInfo').textContent = 'no lines to save';
      return;
    }
    $('macroEditInfo').textContent = 'saving...';
    const res = await cmd({ cmd: 'toTab', type: 'macro:edit', lines });
    if (res && res.ok) {
      macroTextDirty = false;
      $('macroEditInfo').textContent = `saved ${res.count} action(s)` + (res.skipped ? `, ${res.skipped} line(s) skipped` : '');
      setTimeout(refresh, 400);
    } else {
      $('macroEditInfo').textContent = 'could not reach target tab';
    }
  });

  $('exportBtn').addEventListener('click', async () => {
    const data = await chrome.storage.local.get('mbd');
    const blob = new Blob([JSON.stringify(data.mbd || settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'magic-bot-macro.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  $('importBtn').addEventListener('click', () => {
    $('importFile').click();
  });

  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const obj = JSON.parse(text);
      if (!obj || typeof obj !== 'object') throw new Error('invalid json');
      const merged = { ...defaults, ...obj };
      macroTextDirty = false;
      await chrome.storage.local.set({ mbd: merged });
      $('statusLine').textContent = 'imported ' + (Array.isArray(merged.macros) ? merged.macros.length : 0) + ' macro(s)';
      setTimeout(refresh, 400);
    } catch (err) {
      $('statusLine').textContent = 'import failed: ' + String(err && err.message ? err.message : err);
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'log' && msg.payload) {
      log.push(msg.payload);
      while (log.length > 300) log.shift();
      renderLog();
    } else if (msg && msg.type === 'status' && msg.payload) {
      status = msg.payload;
      renderStatus();
    }
  });

  refresh();
  setInterval(refresh, 1000);
})();
