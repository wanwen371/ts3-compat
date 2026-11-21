// Drive the real UI in headless Chrome over CDP: fill the connect form, click
// connect, wait for the server state, screenshot, then report what rendered.
import WebSocket from 'ws';
import { writeFileSync } from 'node:fs';

const CDP = process.env.CDP ?? 'http://127.0.0.1:9333';
const targets = await (await fetch(`${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === 'page' && t.url.includes(':8787'));
if (!page) { console.error('no page target'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
let id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const msgId = ++id;
  pending.set(msgId, { resolve, reject });
  ws.send(JSON.stringify({ id: msgId, method, params }));
});
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  }
});
await new Promise((r) => ws.on('open', r));

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ' ' + JSON.stringify(result.exceptionDetails.exception?.description ?? ''));
  return result.result?.value;
};

await send('Runtime.enable');
await send('Page.enable');

// Navigate fresh so the page is in its initial state.
await send('Page.navigate', { url: 'http://127.0.0.1:8787/' });
await new Promise((r) => setTimeout(r, 1500));

const dump = async (label) => {
  const text = await evaluate('document.body.innerText.slice(0, 600)');
  console.log(`--- ${label} ---\n${text.replace(/\n{2,}/g, '\n')}\n`);
};

await dump('connect page');

// Fill the form: first text input = server, second = port, third = nickname.
const filled = await evaluate(`(() => {
  const inputs = [...document.querySelectorAll('input')];
  const setVal = (el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const info = inputs.map((i) => i.type + ':' + (i.placeholder || i.name || i.id || ''));
  if (inputs[0]) setVal(inputs[0], '127.0.0.1');
  if (inputs[1]) setVal(inputs[1], '9987');
  const nick = inputs.find((i) => /昵称|nick/i.test(i.placeholder || '') || i.type === 'text');
  const textInputs = inputs.filter((i) => i.type === 'text');
  if (textInputs[2]) setVal(textInputs[2], 'e2e-probe');
  return info;
})()`);
console.log('inputs:', JSON.stringify(filled));

// Click the connect button (the primary action in the card).
const clicked = await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('button')];
  const labels = buttons.map((b) => b.innerText.trim());
  const target = buttons.find((b) => /连接/.test(b.innerText) && !/断开/.test(b.innerText));
  if (!target) return { labels };
  target.click();
  return { labels, clicked: target.innerText.trim() };
})()`);
console.log('clicked:', JSON.stringify(clicked));

// Wait for the client view: channel rows / connected marker.
let state = null;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 500));
  state = await evaluate(`(() => ({
    connected: /已连接|连接成功|在线/.test(document.body.innerText),
    hasChannel: /Default Channel|大厅|频道/.test(document.body.innerText),
    text: document.body.innerText.slice(0, 300),
  }))()`);
  if (state.connected && state.hasChannel) break;
}
console.log('state:', JSON.stringify(state).slice(0, 400));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('docs/ui-e2e-connected.png', Buffer.from(shot.data, 'base64'));
console.log('screenshot -> docs/ui-e2e-connected.png');

const errors = await evaluate('window.__e2eErrors ? JSON.stringify(window.__e2eErrors) : "none"');
console.log('page errors:', errors);
ws.close();
process.exit(0);
