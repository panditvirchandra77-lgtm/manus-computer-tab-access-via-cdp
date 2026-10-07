#!/usr/bin/env node
// cdp-shot.mjs — Screenshot (full page) + page metadata + innerText via CDP.
// Usage: node cdp-shot.mjs <webSocketDebuggerUrl> [out.png]
// Node >= 18, zero dependencies.

const wsUrl = process.argv[2];
const outPng = process.argv[3] || '/tmp/cdp-shot.png';
if (!wsUrl) {
  console.error('Usage: node cdp-shot.mjs <webSocketDebuggerUrl> [out.png]');
  process.exit(2);
}

const ws = new WebSocket(wsUrl);
let id = 0;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  }
};
ws.onerror = (e) => { console.error('WS error:', e.message || e); process.exit(2); };

ws.onopen = async () => {
  try {
    // Let the page settle a bit (loading/blank pages give tiny screenshots)
    await new Promise((r) => setTimeout(r, 2500));

    const info = await send('Runtime.evaluate', {
      expression: `JSON.stringify({
        title: document.title,
        url: location.href,
        readyState: document.readyState,
        bodyLen: document.body ? document.body.innerText.length : -1,
        htmlLen: document.documentElement.outerHTML.length,
        canvases: document.querySelectorAll('canvas').length,
        iframes: document.querySelectorAll('iframe').length,
        text: document.body ? document.body.innerText.slice(0, 3000) : ''
      })`,
      returnByValue: true,
    }).then((r) => JSON.parse(r.result.value));

    console.log('TITLE:', info.title);
    console.log('URL:', info.url);
    console.log('META:', JSON.stringify({
      readyState: info.readyState,
      bodyTextLen: info.bodyLen,
      htmlLen: info.htmlLen,
      canvases: info.canvases,
      iframes: info.iframes,
    }));
    if (info.text) {
      console.log('---TEXT---');
      console.log(info.text);
    } else {
      console.log('---TEXT--- (empty — canvas-rendered page? try cdp-term.mjs)');
    }

    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    const fs = await import('node:fs');
    fs.writeFileSync(outPng, Buffer.from(shot.data, 'base64'));
    console.log('SCREENSHOT_SAVED:', outPng, `(${fs.statSync(outPng).size} bytes)`);
    ws.close();
    process.exit(0);
  } catch (e) {
    console.error('CDP error:', e.message);
    process.exit(1);
  }
};