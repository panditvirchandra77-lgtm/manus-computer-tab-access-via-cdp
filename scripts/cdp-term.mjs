#!/usr/bin/env node
// cdp-term.mjs — Read an xterm.js / web-terminal buffer via CDP.
// Canvas terminals render glyphs to <canvas>, so innerText is always empty.
// The real content lives in the xterm.js buffer object.
//
// Usage: node cdp-term.mjs <webSocketDebuggerUrl>
// Node >= 18, zero dependencies.

const wsUrl = process.argv[2];
if (!wsUrl) {
  console.error('Usage: node cdp-term.mjs <webSocketDebuggerUrl>');
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
    const expr = `(function(){
      function readTerm(t){
        try {
          const buf = t.buffer.active;
          const lines = [];
          const start = Math.max(0, buf.baseY);
          for (let y = start; y < buf.baseY + buf.length; y++) {
            const line = buf.getLine(y);
            if (line) lines.push(line.translateToString(true));
          }
          return lines.join('\\n');
        } catch(e){ return 'ERR:'+e.message; }
      }
      // 1) common globals
      for (const g of ['term','xterm','terminal','xtermTerminal']) {
        if (window[g] && window[g].buffer) { const t=readTerm(window[g]); if(t && !t.startsWith('ERR')) return 'SRC:'+g+'\\n'+t; }
      }
      // 2) elements with __xterm* / __term* props
      const els = document.querySelectorAll('.xterm, .xterm-helper-textarea, .terminal');
      for (const el of els) {
        for (const k in el) {
          if (k.startsWith('__xterm') || k.startsWith('__term')) {
            const t = el[k];
            if (t && t.buffer) { const r = readTerm(t); if (r && !r.startsWith('ERR')) return 'SRC:el.'+k+'\\n'+r; }
          }
        }
      }
      // 3) brute scan all elements' __* props for a buffer object
      const all = document.querySelectorAll('*');
      for (const el of all) {
        for (const k in el) {
          if (k.startsWith('__')) {
            const t = el[k];
            if (t && t.buffer && t.buffer.active && t.buffer.getLine) {
              const r = readTerm(t); if (r && !r.startsWith('ERR')) return 'SCAN\\n'+r;
            }
          }
        }
      }
      return 'NO_XTERM_FOUND. bodyClasses='+document.body.className+' canvases='+document.querySelectorAll('canvas').length;
    })()`;

    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    console.log(r.result.value);
    ws.close();
    process.exit(0);
  } catch (e) {
    console.error('CDP error:', e.message);
    process.exit(1);
  }
};