#!/usr/bin/env node
// cdp-eval.mjs — Evaluate arbitrary JS in a tab via CDP, print the result.
// Usage: node cdp-eval.mjs <webSocketDebuggerUrl> <expression>
// Node >= 18, zero dependencies.

const wsUrl = process.argv[2];
const expr = process.argv.slice(3).join(' ');
if (!wsUrl || !expr) {
  console.error('Usage: node cdp-eval.mjs <webSocketDebuggerUrl> <expression>');
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
    const r = await send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      console.error('EXCEPTION:', JSON.stringify(r.exceptionDetails, null, 2));
      process.exit(1);
    }
    const v = r.result.value;
    console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
    ws.close();
    process.exit(0);
  } catch (e) {
    console.error('CDP error:', e.message);
    process.exit(1);
  }
};