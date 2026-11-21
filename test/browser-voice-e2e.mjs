// Browser PTT end-to-end: real UI (headless Chrome + fake mic) holds the
// push-to-talk button; a Node client listens on the real TS3 server.
import WebSocket from 'ws';
import { Ts3Connection } from '../server/ts3/connection.js';

const CDP = 'http://127.0.0.1:9333';
const targets = await (await fetch(`${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === 'page' && t.url.includes(':8787'));
if (!page) { console.error('no page'); process.exit(1); }

const rx = new Ts3Connection({ host: '127.0.0.1', port: 9987, nickname: 'voice-rx', voiceCodec: 4, voiceQuality: 6 });
const heard = [];
rx.on('voice', (f) => heard.push({ from: f.clid, seq: f.seq, bytes: f.data?.length ?? 0 }));
await rx.connect('voice-rx');
console.log('receiver connected clid=', rx.selfClid);

const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id; pending.set(mid, { res, rej });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
});
await new Promise((r) => ws.on('open', r));
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result?.value;
};
await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'http://127.0.0.1:8787/' });
await new Promise((r) => setTimeout(r, 1500));

await evaluate(`(() => {
  const ins = [...document.querySelectorAll('input[type=text]')];
  const set = (el,v) => { el.value=v; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); };
  if (ins[0]) set(ins[0], '127.0.0.1');
  if (ins[1]) set(ins[1], '9987');
  if (ins[2]) set(ins[2], 'browser-ptt');
  const btn = [...document.querySelectorAll('button')].find(b => /^连接$/.test(b.innerText.trim()));
  if (btn) btn.click();
  return true;
})()`);

for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const ok = await evaluate('document.body.innerText.includes("在线 1") || document.body.innerText.includes("在线客户端")');
  if (ok) break;
}
console.log('ui connected:', await evaluate('document.body.innerText.slice(0,80).replace(/\\n/g," ")'));
console.log('audio state:', await evaluate('(document.querySelector("[data-audio-state]")||{}).getAttribute?.("data-audio-state") || document.body.innerText.match(/音频[^\\n]*/)?.[0]'));

// Hold the push-to-talk button for ~3 s using real pointer events.
const held = await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => /按住说话/.test(b.innerText));
  if (!btn) return 'no-ptt-button';
  const r = btn.getBoundingClientRect();
  const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 };
  btn.dispatchEvent(new PointerEvent('pointerdown', opts));
  btn.dispatchEvent(new MouseEvent('mousedown', opts));
  return 'held';
})()`);
console.log('ptt:', held);

await new Promise((r) => setTimeout(r, 3000));
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => /按住说话/.test(b.innerText));
  if (!btn) return 'no-ptt-button';
  const r = btn.getBoundingClientRect();
  const opts = { bubbles: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0 };
  btn.dispatchEvent(new PointerEvent('pointerup', opts));
  btn.dispatchEvent(new MouseEvent('mouseup', opts));
  return 'released';
})()`);

await new Promise((r) => setTimeout(r, 1200));
console.log('received voice packets:', heard.length, JSON.stringify(heard.slice(0, 5)));
const shot = await send('Page.captureScreenshot', { format: 'png' });
(await import('node:fs')).writeFileSync('docs/ui-e2e-voice.png', Buffer.from(shot.data, 'base64'));
console.log('screenshot -> docs/ui-e2e-voice.png');
ws.close(); rx.close();
process.exit(heard.length > 0 ? 0 : 1);
