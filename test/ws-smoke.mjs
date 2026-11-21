import WebSocket from 'ws';
const ws = new WebSocket('ws://127.0.0.1:8787/ws');
const seen = [];
ws.on('open', () => { ws.send(JSON.stringify({op:'connect', host:'127.0.0.1', port:9987, nickname:'wsprobe'})); });
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  seen.push(m.ev);
  console.log('EV', m.ev, JSON.stringify(m).slice(0, 160));
  if (m.ev === 'state' && m.phase === 'connected') {
    setTimeout(() => { ws.send(JSON.stringify({op:'chat', text:'hello from ws'})); }, 800);
  }
});
setTimeout(() => { console.log('EVENTS:', seen.join(',')); ws.close(); process.exit(0); }, 15000);
