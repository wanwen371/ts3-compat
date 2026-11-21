#!/usr/bin/env node
// End-to-end protocol probe: connect to a real TeamSpeak 3 server, join a
// channel, print the server snapshot, send a chat message and wait for the
// echoed notification.
//
//   node test/client-cli.js --host 127.0.0.1 --port 9987 --nickname probe --channel 1

import { Ts3Connection } from '../server/ts3/connection.js';
import { createIdentity } from '../server/ts3/handshake.js';
import * as command from '../server/ts3/command.js';

function parseArgs(argv) {
  const args = {
    host: '127.0.0.1',
    port: 9987,
    nickname: `probe-${Math.floor(Math.random() * 1000)}`,
    channel: 0,
    timeout: 20000,
    verbose: false,
    identity: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case '--host':
        args.host = next();
        break;
      case '--port':
        args.port = Number.parseInt(next(), 10);
        break;
      case '--nickname':
        args.nickname = next();
        break;
      case '--channel':
        args.channel = Number.parseInt(next(), 10);
        break;
      case '--timeout':
        args.timeout = Number.parseInt(next(), 10);
        break;
      case '--verbose':
        args.verbose = true;
        break;
      case '--level':
        args.level = Number.parseInt(next(), 10);
        break;
      case '--help':
      case '-h':
        console.log(
          'usage: node test/client-cli.js [--host H] [--port P] [--nickname N] [--channel CID] [--level 8] [--verbose]',
        );
        process.exit(0);
        break;
      default:
        if (arg.startsWith('--')) {
          console.error(`unknown option ${arg}`);
          process.exit(2);
        }
    }
  }
  return args;
}

function rowList(rows, keys) {
  return rows.map((row) => Object.fromEntries(keys.map((k) => [k, row[k]])));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const identity = createIdentity(args.level ?? 8);
  const connection = new Ts3Connection({
    host: args.host,
    port: args.port,
    identity,
    verbose: args.verbose,
  });

  connection.on('log', ({ level, text }) => {
    if (level === 'debug' && !args.verbose) return;
    console.log(`[${level}] ${text}`);
  });
  connection.on('state', ({ phase, error }) => {
    console.log(`[state] ${phase}${error ? `: ${error}` : ''}`);
  });
  connection.on('error', (err) => console.error(`[error] ${err.message}`));

  const deadline = setTimeout(() => {
    console.error(`[fatal] overall timeout after ${args.timeout} ms`);
    connection.close();
    process.exit(1);
  }, args.timeout);

  try {
    const started = Date.now();
    const info = await connection.connect(args.nickname, {
      channelId: args.channel || undefined,
    });
    console.log(`[ok] handshake+clientinit in ${Date.now() - started} ms; clid=${info.clientId}`);

    const snapshot = connection.snapshot();

    // serverinfo: the voice protocol pushes it in initserver, it is not
    // requestable by an unprivileged client (serverinfo needs
    // b_virtualserver_info_view).
    const si = info.raw ?? {};
    console.log(
      `[serverinfo] name=${JSON.stringify(si.virtualserver_name)} ` +
        `platform=${si.virtualserver_platform} version=${si.virtualserver_version} ` +
        `clients=${snapshot.clients.length}/${si.virtualserver_maxclients} ` +
        `channels=${snapshot.channels.length} ` +
        `port=${si.virtualserver_ip}:${connection.port} ` +
        `welcome=${JSON.stringify((si.virtualserver_welcomemessage ?? '').slice(0, 60))}`,
    );

    let channels = snapshot.channels;
    if (channels.length === 0) {
      channels = (await connection.command('channellist')).rows.map((row) => ({
        cid: Number(row.cid),
        pid: Number(row.cpid ?? 0),
        name: row.channel_name,
        codec: Number(row.channel_codec ?? 4),
      }));
    }
    console.log(`[channellist] ${channels.length} channel(s):`);
    for (const channel of channels) {
      console.log(
        `  - cid=${channel.cid} pid=${channel.pid} name=${JSON.stringify(channel.name)} ` +
          `order=${channel.order ?? 0} codec=${channel.codec} ` +
          `clients=${channel.totalClients ?? '?'} default=${channel.isDefault ? 'yes' : 'no'}`,
      );
    }

    console.log(`[clientlist] ${snapshot.clients.length} client(s):`);
    for (const client of snapshot.clients) {
      console.log(
        `  - clid=${client.clid} cid=${client.cid} nickname=${JSON.stringify(client.nickname)} ` +
          `type=${client.type}${client.isSelf ? ' (self)' : ''}`,
      );
    }

    if (args.channel) {
      let code = 0;
      try {
        const join = await connection.join(args.channel);
        code = join.error?.id ?? 0;
      } catch (err) {
        // 770 = already member of that channel, which is success for "join".
        const match = /server error (\d+)/.exec(err.message);
        code = match ? Number.parseInt(match[1], 10) : -1;
        if (code !== 770) console.log(`[join] error: ${err.message}`);
      }
      console.log(
        `[join] channel ${args.channel}: error id=${code}` +
          `${code === 770 ? ' (already member, ok)' : ''}`,
      );
    }

    const echo = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 5000);
      const handler = ({ type, data }) => {
        if (type !== 'textmessage') return;
        clearTimeout(timer);
        connection.off('event', handler);
        resolve(data);
      };
      connection.on('event', handler);
    });

    const text = `probe hello ${new Date().toISOString()}`;
    const sent = await connection.chat(text);
    console.log(
      `[chat] sent ${JSON.stringify(text)} error=${sent.error ? sent.error.message : 'none'} answered=${sent.answered}`,
    );

    const message = await echo;
    if (message) {
      console.log(
        `[echo] from clid=${message.invokerid} nickname=${JSON.stringify(message.invokername)} ` +
          `targetmode=${message.targetmode} msg=${JSON.stringify(message.msg)}`,
      );
      if (message.msg !== text) {
        console.log('[echo] WARNING: echoed text differs from the one sent');
      }
    } else {
      console.log('[echo] no notifytextmessage within 5 s');
    }

    const stats = connection.statsSnapshot;
    console.log(
      `[stats] ping=${stats.ping}ms sent=${stats.sentPackets}p/${stats.sentBytes}B ` +
        `recv=${stats.recvPackets}p/${stats.recvBytes}B`,
    );

    await connection.disconnect();
    clearTimeout(deadline);
    console.log('[done] ok');
    process.exit(0);
  } catch (err) {
    clearTimeout(deadline);
    console.error(`[fatal] ${err.stack || err.message}`);
    connection.close();
    process.exit(1);
  }
}

main();