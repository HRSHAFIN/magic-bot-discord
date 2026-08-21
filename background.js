const INJECT_FILES = ['content/engine.js', 'content/content.js'];

const cdpSessions = new Map();

function ensureCdp(tabId) {
  if (cdpSessions.has(tabId)) return Promise.resolve(true);
  return new Promise((resolve) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) {
        resolve(false);
        return;
      }
      cdpSessions.set(tabId, true);
      resolve(true);
    });
  });
}

function cdpDetach(tabId) {
  if (!cdpSessions.has(tabId)) return Promise.resolve();
  cdpSessions.delete(tabId);
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => {
      resolve();
    });
  });
}

function cdpCommand(tabId, method, params) {
  return new Promise((resolve) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ __err: chrome.runtime.lastError.message });
        return;
      }
      resolve(res || {});
    });
  });
}

async function cdpMouse(tabId, type, p) {
  const ok = await ensureCdp(tabId);
  if (!ok) return false;
  const res = await cdpCommand(tabId, 'Input.dispatchMouseEvent', { type, ...p });
  return !res.__err;
}

async function cdpClick(tabId, x, y) {
  const ok = await ensureCdp(tabId);
  if (!ok) return false;
  const p = { x, y, button: 'left', clickCount: 1, pointerType: 'mouse' };
  await cdpMouse(tabId, 'mouseMoved', p);
  const pressed = await cdpMouse(tabId, 'mousePressed', p);
  await new Promise((r) => setTimeout(r, 50));
  const released = await cdpMouse(tabId, 'mouseReleased', p);
  return pressed && released;
}

async function cdpKey(tabId, spec) {
  const ok = await ensureCdp(tabId);
  if (!ok) return false;
  const printable = typeof spec.key === 'string' && spec.key.length === 1;
  const base = {
    modifiers: spec.modifiers || 0,
    key: spec.key,
    code: spec.code,
    windowsVirtualKeyCode: spec.vk,
    nativeVirtualKeyCode: spec.vk
  };
  const down = await cdpCommand(tabId, 'Input.dispatchKeyEvent', {
    type: printable ? 'keyDown' : 'rawKeyDown',
    ...base,
    ...(printable ? { text: spec.key, unmodifiedText: spec.key } : {})
  });
  await new Promise((r) => setTimeout(r, 45));
  const up = await cdpCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  return !down.__err && !up.__err;
}

async function cdpScroll(tabId, x, y, dx, dy) {
  const ok = await ensureCdp(tabId);
  if (!ok) return false;
  const res = await cdpCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x,
    y,
    deltaX: dx || 0,
    deltaY: dy || 0
  });
  return !res.__err;
}

chrome.debugger.onDetach.addListener((source) => {
  cdpSessions.delete(source.tabId);
});

async function getTarget() {
  const data = await chrome.storage.local.get('mbdtarget');
  return data.mbdtarget || null;
}

async function setTarget(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const target = { tabId, url: tab.url, title: tab.title };
    await chrome.storage.local.set({ mbdtarget: target });
    return target;
  } catch (e) {
    return null;
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

async function getTab() {
  const target = await getTarget();
  if (target && target.tabId) {
    try {
      return await chrome.tabs.get(target.tabId);
    } catch (e) {}
  }
  return null;
}

function sendToTab(tabId, msg) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), 4000);
    chrome.tabs.sendMessage(tabId, msg).then(
      (resp) => {
        clearTimeout(timer);
        resolve(resp && typeof resp === 'object' ? resp : { ok: true });
      },
      (err) => {
        clearTimeout(timer);
        resolve({ ok: false, reason: String(err && err.message ? err.message : err) });
      }
    );
  });
}

async function ensureInjected(tabId) {
  const ping = await sendToTab(tabId, { type: 'ping' });
  if (ping.ok) return true;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: INJECT_FILES
    });
  } catch (e) {
    return false;
  }
  await new Promise((r) => setTimeout(r, 300));
  const ping2 = await sendToTab(tabId, { type: 'ping' });
  return ping2.ok;
}

async function routeToActiveTab(type, extra) {
  const tab = await getActiveTab();
  if (!tab) return { ok: false, reason: 'no active tab' };
  await setTarget(tab.id);
  await ensureInjected(tab.id);
  return sendToTab(tab.id, { type, ...(extra || {}) });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string' || msg.type !== 'cmd') return;

  (async () => {
    const cmd = msg.payload || {};
    try {
      switch (cmd.cmd) {
        case 'cdp:attach': {
          const tabId = sender.tab ? sender.tab.id : null;
          if (!tabId) return sendResponse({ ok: false, reason: 'no tab' });
          const ok = await ensureCdp(tabId);
          sendResponse({ ok });
          break;
        }
        case 'cdp:detach': {
          const tabId = sender.tab ? sender.tab.id : null;
          if (tabId) await cdpDetach(tabId);
          sendResponse({ ok: true });
          break;
        }
        case 'cdp:click': {
          const tabId = sender.tab ? sender.tab.id : null;
          if (!tabId) return sendResponse({ ok: false, reason: 'no tab' });
          const ok = await cdpClick(tabId, cmd.x, cmd.y);
          sendResponse({ ok });
          break;
        }
        case 'cdp:key': {
          const tabId = sender.tab ? sender.tab.id : null;
          if (!tabId) return sendResponse({ ok: false, reason: 'no tab' });
          const ok = await cdpKey(tabId, cmd.spec);
          sendResponse({ ok });
          break;
        }
        case 'cdp:scroll': {
          const tabId = sender.tab ? sender.tab.id : null;
          if (!tabId) return sendResponse({ ok: false, reason: 'no tab' });
          const ok = await cdpScroll(tabId, cmd.x, cmd.y, cmd.dx, cmd.dy);
          sendResponse({ ok });
          break;
        }
        case 'tab:get': {
          const target = await getTarget();
          sendResponse({
            ok: true,
            found: !!target,
            tabId: target ? target.tabId : null,
            url: target ? target.url : null,
            title: target ? target.title : null
          });
          break;
        }
        case 'tab:set': {
          const target = await setTarget(cmd.tabId);
          sendResponse({ ok: !!target, tabId: cmd.tabId });
          break;
        }
        case 'toTab': {
          let tab = await getTab();
          if (!tab) {
            tab = await getActiveTab();
            if (tab) await setTarget(tab.id);
          }
          if (!tab) return sendResponse({ ok: false, reason: 'no target tab' });
          await ensureInjected(tab.id);
          if (cmd.ensureActive) await chrome.tabs.update(tab.id, { active: true });
          const { cmd: _drop, type, ...extra } = cmd;
          const resp = await sendToTab(tab.id, { type, ...extra });
          sendResponse({ ok: true, tabId: tab.id, ...resp });
          break;
        }
        default:
          sendResponse({ ok: false, reason: 'unknown cmd' });
      }
    } catch (e) {
      sendResponse({ ok: false, reason: String(e && e.message ? e.message : e) });
    }
  })();

  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-recording') {
    const st = await routeToActiveTab('record:status');
    if (st && st.active) await routeToActiveTab('record:stop');
    else await routeToActiveTab('record:start');
  } else if (command === 'toggle-playback') {
    const st = await routeToActiveTab('play:status');
    if (st && st.running) await routeToActiveTab('play:stop');
    else await routeToActiveTab('play:start');
  } else if (command === 'stop-all') {
    await routeToActiveTab('record:stop');
    await routeToActiveTab('play:stop');
  }
});
