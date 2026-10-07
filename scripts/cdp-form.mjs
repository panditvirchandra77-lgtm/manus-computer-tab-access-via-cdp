#!/usr/bin/env node
// cdp-form.mjs — Inspect a page's form fields via CDP.
// Usage: node cdp-form.mjs <webSocketDebuggerUrl>
const wsUrl = process.argv[2];
if (!wsUrl) { console.error('Usage: node cdp-form.mjs <wsUrl>'); process.exit(2); }
const ws = new WebSocket(wsUrl);
let id = 0; const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } };
ws.onerror = (e) => { console.error('WS error', e.message || e); process.exit(2); };
ws.onopen = async () => {
  try {
    const expr = `(function(){
      const out = { title: document.title, url: location.href, inputs: [], buttons: [], labels: [], h1: [] };
      document.querySelectorAll('h1,h2').forEach(h => out.h1.push(h.innerText.trim().slice(0,80)));
      document.querySelectorAll('input,select,textarea').forEach(el => {
        out.inputs.push({
          tag: el.tagName.toLowerCase(),
          type: el.type || '',
          name: el.name || '',
          id: el.id || '',
          placeholder: el.placeholder || '',
          required: el.required || false,
          checked: el.type==='checkbox' ? el.checked : undefined
        });
      });
      document.querySelectorAll('button, [type=submit], a.btn').forEach(b => out.buttons.push({ text: b.innerText.trim().slice(0,40), type: b.type||'', name: b.name||'' }));
      document.querySelectorAll('label').forEach(l => out.labels.push(l.innerText.trim().slice(0,60)));
      return JSON.stringify(out, null, 2);
    })()`;
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    console.log(r.result.value);
    ws.close(); process.exit(0);
  } catch (e) { console.error('CDP error:', e.message); process.exit(1); }
};