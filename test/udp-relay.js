// UDP relay: logs every datagram in both directions so a real TS3 client handshake
// can be captured as ground truth.  usage: node test/udp-relay.js [listen] [target]
import dgram from 'node:dgram';
import { appendFileSync } from 'node:fs';

const LISTEN = Number(process.argv[2] ?? 9999);
const TARGET = Number(process.argv[3] ?? 9987);
const TARGET_HOST = '127.0.0.1';
const LOG = process.env.RELAY_LOG ?? '/tmp/ts3-relay.log';

const front = dgram.createSocket('udp4');
const back = dgram.createSocket('udp4');
let clientAddr = null;

function hex(buf, max = 96) {
  const part = buf.subarray(0, max).toString('hex').replace(/(.{2})/g, '$1 ').trim();
  return buf.length > max ? `${part} … (+${buf.length - max}B)` : part;
}

function log(dir, buf) {
  const line = `${new Date().toISOString()} ${dir} ${buf.length}B  ${hex(buf)}\n`;
  process.stdout.write(line);
  appendFileSync(LOG, line);
}

front.on('message', (msg, rinfo) => {
  clientAddr = rinfo;
  log('C->S', msg);
  back.send(msg, TARGET, TARGET_HOST);
});

back.on('message', (msg) => {
  log('S->C', msg);
  if (clientAddr) front.send(msg, clientAddr.port, clientAddr.address);
});

front.bind(LISTEN, '127.0.0.1', () => console.log(`relay listening on ${LISTEN} -> ${TARGET}`));