// Verify the WS bridge voice path: a Node receiver client listens on the real
// server, while a WS session sends frames through op "voiceFrame".
import WebSocket from 'ws';
import { Ts3Connection } from '../server/ts3/connection.js';

const receiver = new Ts3Connection({ host: '127.0.0.1', port: 9987, nickname: 'bridge-rx', voiceCodec: 4, voiceQuality: 6 });
const heard = [];
receiver.on('voice', (frame) => {
  heard.push({ from: frame.clid, seq: frame.seq, codec: frame.codec, bytes: frame.data?.length ?? 0 });
});
await receiver.connect('bridge-rx');
console.log('receiver connected, clid=', receiver.selfClid);

const ws = new WebSocket('ws://127.0.0.1:8787/ws');
let connected = false;
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  if (m.ev === 'state' && m.phase === 'connected' && !connected) {
    connected = true;
    console.log('ws session connected');
    // 10 frames of 60 distinct bytes, one per 20 ms
    let i = 0;
    const timer = setInterval(() => {
      const frame = Buffer.alloc(60, i + 1);
      ws.send(JSON.stringify({ op: 'voiceFrame', codec: 4, data: frame.toString('base64') }));
      if (++i >= 10) clearInterval(timer);
    }, 20);
  }
});
ws.on('open', () => ws.send(JSON.stringify({ op: 'connect', host: '127.0.0.1', port: 9987, nickname: 'bridge-tx' })));
await new Promise((r) => setTimeout(r, 6000));
console.log('receiver heard', heard.length, 'packets:', JSON.stringify(heard.slice(0, 4)));
const ok = heard.length > 0 && heard.every((h) => h.bytes === 60);
console.log(ok ? 'VOICE BRIDGE OK' : 'VOICE BRIDGE FAILED');
ws.close();
receiver.close();
process.exit(ok ? 0 : 1);
