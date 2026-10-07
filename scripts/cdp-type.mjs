#!/usr/bin/env node
// cdp-type.mjs — Type a command into a web terminal via CDP key events.
// Usage: node cdp-type.mjs <webSocketDebuggerUrl> <text> [--enter]
//   --enter  press Enter after typing (default: yes, unless --no-enter)
// Node >= 18, zero dependencies.

const wsUrl = process.argv[2];
const args = process.argv.slice(3);
const noEnter = args.includes('--no-enter');
const text = args.filter((a) => !a.startsWith('--')).join(' ');
if (!wsUrl || !text) {
  console.error('Usage: node cdp-type.mjs <webSocketDebuggerUrl> <text> [--no-enter]');
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

function keyEvent(type, key, extra = {}) {
  return send('Input.dispatchKeyEvent', { type, key, ...extra });
}

ws.onopen = async () => {
  try {
    // Click into the terminal area first (focus the xterm textarea)
    const focus = await send('Runtime.evaluate', {
      expression: `(function(){
        const ta = document.querySelector('.xterm-helper-textarea, textarea');
        if (ta) { ta.focus(); return 'focused:'+(ta.className||'textarea'); }
        const c = document.querySelector('canvas');
        if (c) { c.dispatchEvent(new MouseEvent('click',{bubbles:true})); return 'clicked-canvas'; }
        return 'no-target';
      })()`,
      returnByValue: true,
    });
    console.log('FOCUS:', focus.result.value);

    for (const ch of text) {
      const code = ch === ' ' ? 'Space' : ch.length === 1 ? ch.toUpperCase() : ch;
      await keyEvent('keyDown', ch, { text: ch, unmodifiedText: ch, code, key: ch });
      await keyEvent('keyUp', ch, { code, key: ch });
      await new Promise((r) => setTimeout(r, 30)); // let the PTY keep up
    }

    if (!noEnter) {
      await keyEvent('rawKeyDown', 'Enter', { code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      await keyEvent('keyUp', 'Enter', { code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    }
    console.log('TYPED:', JSON.stringify(text), noEnter ? '(no enter)' : '(enter sent)');
    ws.close();
    process.exit(0);
  } catch (e) {
    console.error('CDP error:', e.message);
    process.exit(1);
  }
};