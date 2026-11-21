// Offline unit tests for the TS3 protocol layer: crypto primitives, the
// initivexpand2 key exchange, INIT1 wire layouts (pinned to the real-client
// capture in test/capture/), packet framing, command syntax and QuickLZ.
//
//   node test/handshake.test.js
//
// Everything here runs without a server: the vectors come from RFC 4493
// (AES-CMAC), the tsproto reference implementation (initivexpand2 key schedule)
// and the real 3.5.6 client capture (handshake byte layouts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, verify } from 'node:crypto';

import * as crypto from '../server/ts3/crypto.js';
import * as handshake from '../server/ts3/handshake.js';
import {
  PacketType,
  PacketFlags,
  buildPacket,
  parsePacket,
  packetMtu,
  bodyMtu,
  INIT1_MAC,
  TAG_LENGTH,
  S2C_HEADER_LENGTH,
  C2S_HEADER_LENGTH,
} from '../server/ts3/packet.js';
import { encodeCommand, parseCommand, splitRows, escapeValue, unescapeValue } from '../server/ts3/command.js';
import { Ts3Connection, quicklzDecompress } from '../server/ts3/connection.js';

const hex = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');
const b64 = (s) => Buffer.from(s, 'base64');

// ── AES-CMAC (RFC 4493 test vectors) ────────────────────────────────────────

test('aesCmac matches RFC 4493', () => {
  const key = hex('2b7e151628aed2a6abf7158809cf4f3c');
  assert.equal(crypto.aesCmac(key, Buffer.alloc(0)).toString('hex'), 'bb1d6929e95937287fa37d129b756746');
  assert.equal(
    crypto.aesCmac(key, hex('6bc1bee22e409f96e93d7e117393172a')).toString('hex'),
    '070a16b46b4d4144f79bdd9dd04a287c',
  );
  assert.equal(
    crypto.aesCmac(
      key,
      hex('6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411'),
    ).toString('hex'),
    'dfa66747de9ae63030ca32611497c827',
  );
  assert.equal(
    crypto.aesCmac(
      key,
      hex(
        '6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51' +
          '30c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710',
      ),
    ).toString('hex'),
    '51f0bebf7e3b9d92fc49741779363cfe',
  );
});

test('EAX encrypt/decrypt roundtrip and tamper detection', () => {
  const key = Buffer.alloc(16, 0x11);
  const nonce = Buffer.alloc(16, 0x22);
  const header = hex('0001000002');
  const plaintext = Buffer.from('a command line with spaces', 'utf8');
  const sealed = crypto.eaxEncrypt({ key, nonce, header, plaintext });
  assert.equal(sealed.length, TAG_LENGTH + plaintext.length);
  const opened = crypto.eaxDecrypt({ key, nonce, header, ciphertext: sealed.subarray(8), tag: sealed.subarray(0, 8) });
  assert.deepEqual(opened, plaintext);
  // Flip a ciphertext bit: the 8-byte tag must reject it.
  sealed[sealed.length - 1] ^= 0x01;
  assert.equal(
    crypto.eaxDecrypt({ key, nonce, header, ciphertext: sealed.subarray(8), tag: sealed.subarray(0, 8) }),
    null,
  );
});

test('EAX with the public dummy key decrypts a captured real packet', () => {
  // From test/capture/handshake-2026-11-21.log: the client's ACK of the
  // server's (dummy-encrypted) initivexpand2 command. Plaintext is the acked
  // packet id 0.
  const datagram = hex('a47b4794dba96ac50000000006fe18');
  const plaintext = crypto.eaxDecrypt({
    key: crypto.FAKE_KEY,
    nonce: crypto.FAKE_NONCE,
    header: datagram.subarray(8, 8 + C2S_HEADER_LENGTH),
    ciphertext: datagram.subarray(8 + C2S_HEADER_LENGTH),
    tag: datagram.subarray(0, 8),
  });
  assert.equal(plaintext.toString('hex'), '0000');
  assert.equal(crypto.FAKE_KEY.toString('ascii'), 'c:\\windows\\syste');
  assert.equal(crypto.FAKE_NONCE.toString('ascii'), 'm\\firewall32.cpl');
});

// ── per-packet key derivation (KDF) ────────────────────────────────────────

test('per-packet KDF matches the reference key schedule', () => {
  // IV built from the reference initivexpand2 test values (see below).
  const iv = hex(
    '7e34c4df0a5dbbacc92fd1a7d2486c2ea2f41797852545cfc89219012b2d5284' +
      '2b2bdd98ffc972952123f3f66ada55d9d84a37e33b2d23fe38fd14ae06670916',
  );
  const { key, nonce } = crypto.derivePacketKey({
    iv,
    packetType: PacketType.COMMAND,
    generationId: 0,
    fromServer: false,
  });
  assert.equal(
    key.toString('hex') + nonce.toString('hex'),
    'f370d343e77815707aff6048fbd9ac6bb6333579319b880e2d25ef9ce99e775c',
  );
});

test('packet id is mixed into the first two key bytes', () => {
  const iv = Buffer.alloc(64, 0x5a);
  const base = crypto.derivePacketKey({ iv, packetType: 2, generationId: 0, fromServer: true });
  const mixed = crypto.derivePacketKey({ iv, packetType: 2, generationId: 0, fromServer: true, packetId: 0x1234 });
  assert.equal(mixed.key[0], base.key[0] ^ 0x12);
  assert.equal(mixed.key[1], base.key[1] ^ 0x34);
  assert.deepEqual(mixed.nonce, base.nonce);
  // Direction and generation select different keys.
  const other = crypto.derivePacketKey({ iv, packetType: 2, generationId: 1, fromServer: true });
  assert.notDeepEqual(other.key, base.key);
});

// ── initivexpand2: license chain, Ed25519 ECDH, IV and MAC ──────────────────

test('initivexpand2 key schedule matches the reference vectors', () => {
  const license = b64(
    'AQA1hUFJiiSs0wFXkYuPUJVcDa6XCrZTcsvkB0Ffzz4CmwIITRXgCqeTYAcAAAAgQW5vbnltb3Vz' +
      'AAC4R+5mos+UQ/KCbkpQLMI5WRp4wkQu8e5PZY4zU+/FlyAJwaE8CcJJ/A==',
  );
  const clientEphemeralPrivate = hex('b04ea1d95c7264df0de8b36baa7ca15f7571f51fa054b55127088edd963d6e79');
  const alpha = b64('Jkxq1wIvvhzaCA==');
  const beta = b64('wU5T/MM6toW6Wge9th7VlTlzVZ9JDWypw2P9migfc25pjGP2Tj7Hm6rJpmKeHRr08Ch7BEAR');
  assert.equal(alpha.length, 10);
  assert.equal(beta.length, 54);

  const serverEphemeral = crypto.deriveLicenseKey(license);
  assert.equal(serverEphemeral.length, 32);
  const shared = crypto.ed25519SharedSecret(clientEphemeralPrivate, serverEphemeral);
  assert.equal(
    shared.toString('hex'),
    '5878ae08087205b0132710e981b4af141471adcd8298f3d11d0720727eb21b89' +
      '47821efb02535a8a524d9a7a092c1be71fd19d2a9d4fbde32209e4867d634907',
  );

  const iv = Buffer.from(shared);
  for (let i = 0; i < 10; i++) iv[i] ^= alpha[i];
  for (let i = 0; i < 54; i++) iv[10 + i] ^= beta[i];
  assert.equal(
    iv.toString('hex'),
    '7e34c4df0a5dbbacc92fd1a7d2486c2ea2f41797852545cfc89219012b2d5284' +
      '2b2bdd98ffc972952123f3f66ada55d9d84a37e33b2d23fe38fd14ae06670916',
  );
  const mac = createHash('sha1').update(iv).digest().subarray(0, 8);
  assert.equal(mac.length, 8);
});

test('own ephemeral key: public key matches its private scalar (RFC 8032 style)', () => {
  const ephemeral = crypto.generateEphemeralKey();
  assert.equal(ephemeral.publicKey.length, 32);
  assert.equal(ephemeral.privateKey.length, 32);
  // The point must decode, and two parties must derive the same secret.
  assert.ok(crypto.pointDecompress(ephemeral.publicKey));
  const other = crypto.generateEphemeralKey();
  const sharedA = crypto.ed25519SharedSecret(ephemeral.privateKey, other.publicKey);
  const sharedB = crypto.ed25519SharedSecret(other.privateKey, ephemeral.publicKey);
  assert.deepEqual(sharedA, sharedB);
  assert.equal(sharedA.length, 64);
});

test('deriveInitivexpand2Session wires the parameters together', () => {
  // Reuse the reference license as if the server had sent it; beta must be 54
  // bytes. This checks the assembly (IV layout, MAC, sizes) end to end.
  const license = b64(
    'AQA1hUFJiiSs0wFXkYuPUJVcDa6XCrZTcsvkB0Ffzz4CmwIITRXgCqeTYAcAAAAgQW5vbnltb3Vz' +
      'AAC4R+5mos+UQ/KCbkpQLMI5WRp4wkQu8e5PZY4zU+/FlyAJwaE8CcJJ/A==',
  );
  const beta = Buffer.alloc(54, 0x42);
  const alpha = Buffer.alloc(10, 0x37);
  const identity = handshake.createIdentity(1);
  const session = handshake.deriveInitivexpand2Session({
    identity,
    alpha,
    params: { l: license.toString('base64'), beta: beta.toString('base64'), omega: 'AA==' },
  });
  assert.equal(session.iv.length, 64);
  assert.equal(session.mac.length, 8);
  assert.deepEqual(session.beta, beta);
  assert.equal(session.ephemeralPublicKey.length, 32);
  const expectedMac = createHash('sha1').update(session.iv).digest().subarray(0, 8);
  assert.deepEqual(session.mac, expectedMac);

  // The clientek proof is an ASN.1 ECDSA/SHA-256 signature by the identity over
  // (ephemeral public key || beta), which the server verifies.
  const clientEk = handshake.buildClientEk({
    identity,
    beta,
    ephemeralPublicKey: session.ephemeralPublicKey,
  });
  const parsed = parseCommand(clientEk);
  assert.equal(parsed.name, 'clientek');
  const ek = b64(parsed.params.ek);
  assert.deepEqual(ek, session.ephemeralPublicKey);
});

// ── identity ────────────────────────────────────────────────────────────────

test('identity: P-256 key, hash-cash level and TeamSpeak ASN.1 encoding', () => {
  const identity = handshake.createIdentity(8);
  assert.ok(identity.level >= 8);
  assert.ok(identity.offset >= 0);
  const levelHash = createHash('sha1')
    .update(identity.publicKey)
    .update(String(identity.offset))
    .digest();
  assert.ok(handshake.countTrailingZeroBits(levelHash) >= 8);

  const decoded = handshake.decodeTsPublicKey(identity.publicKeyDer);
  assert.ok(decoded, 'TS public key must decode as SEQUENCE{BitString,size,X,Y}');
  assert.equal(decoded.x.length, 32);
  assert.equal(decoded.y.length, 32);
  assert.equal(decoded.uncompressed.length, 65);
  assert.equal(decoded.uncompressed[0], 0x04);

  // BIT STRING must carry bit-length 1 with the private-key bit clear, which is
  // DER "03 02 07 00" (the server rejects any other length).
  const der = identity.publicKeyDer;
  assert.equal(der[0], 0x30);
  assert.equal(der[2], 0x03);
  assert.equal(der[3], 0x02);
  assert.equal(der[4], 0x07);
  assert.equal(der[5], 0x00);
});

test('clientek proof verifies with the identity public key', async () => {
  const identity = handshake.createIdentity(1);
  const beta = Buffer.alloc(54, 0x42);
  const ephemeral = crypto.generateEphemeralKey();
  const command = handshake.buildClientEk({
    identity,
    beta,
    ephemeralPublicKey: ephemeral.publicKey,
  });
  const parsed = parseCommand(command);
  const proof = b64(parsed.params.proof);
  const jwk = identity.privateKey.export({ format: 'jwk' });
  const { createPublicKey } = await import('node:crypto');
  const publicKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' });
  assert.ok(
    verify('sha256', Buffer.concat([ephemeral.publicKey, beta]), publicKey, proof),
    'clientek proof must verify as ECDSA/SHA-256 over ek||beta',
  );
});

// ── INIT1 wire layout (pinned to the real-client capture) ───────────────────

test('INIT1 client packet layout: 13-byte header, variant 0 is 34 bytes', () => {
  const start = handshake.buildInit1Start();
  assert.equal(start.length, 21, 'variant 0 payload is 21 bytes: 4+1+8+8');
  assert.equal(start.readUInt32BE(0), handshake.INIT1_VERSION);
  assert.equal(start[4], 0x00);
  assert.equal(start.subarray(13).toString('hex'), '0000000000000000');

  const datagram = buildPacket({
    direction: 'c2s',
    type: PacketType.INIT1,
    flags: PacketFlags.UNENCRYPTED,
    packetId: handshake.INIT1_PACKET_ID,
    clientId: 0,
    payload: start,
    mac: INIT1_MAC,
  });
  assert.equal(datagram.length, 34);
  assert.equal(datagram.subarray(0, 8).toString('ascii'), 'TS3INIT1');
  assert.equal(datagram.readUInt16BE(8), 101);
  assert.equal(datagram.readUInt16BE(10), 0);
  assert.equal(datagram[12], 0x88, 'flags 0x80 | type 8');
  assert.equal(datagram[13], 0x0e);
  assert.equal(datagram[14], 0xdc);
});

test('INIT1 variant 2 echoes the server challenge exactly like the capture', () => {
  // Server step 1 from test/capture/handshake-2026-11-21.log.
  const s2cInit1 = hex(
    '545333494e4954310065 88 01 02 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 aa dd 15 96',
  );
  const payload = handshake.buildInit1Step2(s2cInit1.subarray(11));
  assert.equal(payload.length, 25);
  const expected = hex(
    '0edc3ae6 02 02 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 aa dd 15 96',
  );
  assert.deepEqual(payload, expected);

  // The captured client packet was 38 bytes: 13-byte header + 25-byte payload.
  const datagram = buildPacket({
    direction: 'c2s',
    type: PacketType.INIT1,
    flags: PacketFlags.UNENCRYPTED,
    packetId: handshake.INIT1_PACKET_ID,
    clientId: 0,
    payload,
    mac: INIT1_MAC,
  });
  assert.equal(datagram.length, 38);
});

test('INIT1 variant 4 carries puzzle echo, y and clientinitiv', () => {
  const puzzle = {
    x: Buffer.alloc(64, 0x11),
    n: Buffer.alloc(64, 0x13),
    level: 100,
    random2: Buffer.alloc(100, 0x17),
  };
  const identity = handshake.createIdentity(1);
  const alpha = Buffer.alloc(10, 0x21);
  const { payload } = handshake.buildInit1Step4({ puzzle, alpha, identity });
  assert.ok(payload.length > 301, 'variant 4 must exceed the 314-byte packet minimum');
  assert.equal(payload.readUInt32BE(0), handshake.INIT1_VERSION);
  assert.equal(payload[4], 0x04);
  assert.deepEqual(payload.subarray(5, 69), puzzle.x);
  assert.deepEqual(payload.subarray(69, 133), puzzle.n);
  assert.equal(payload.readUInt32BE(133), puzzle.level);
  assert.deepEqual(payload.subarray(137, 237), puzzle.random2);
  const y = payload.subarray(237, 301);
  assert.deepEqual(y, crypto.solveRsaPuzzle(puzzle.x, puzzle.n, puzzle.level));
  const command = parseCommand(payload.subarray(301));
  assert.equal(command.name, 'clientinitiv');
  assert.deepEqual(b64(command.params.alpha), alpha);
  assert.equal(command.params.omega, identity.publicKey);
  assert.equal(command.params.ot, '1');
});

test('parseInit1Step3 reads x, n, level and random2', () => {
  const payload = Buffer.alloc(233);
  payload[0] = 0x03;
  Buffer.alloc(64, 0xab).copy(payload, 1);
  Buffer.alloc(64, 0xcd).copy(payload, 65);
  payload.writeUInt32BE(10000, 129);
  Buffer.alloc(100, 0xef).copy(payload, 133);
  const puzzle = handshake.parseInit1Step3(payload);
  assert.equal(puzzle.level, 10000);
  assert.equal(puzzle.x.toString('hex'), 'ab'.repeat(64));
  assert.equal(puzzle.n.toString('hex'), 'cd'.repeat(64));
  assert.equal(puzzle.random2.toString('hex'), 'ef'.repeat(100));
});

test('RSA puzzle solver: tiny case and 64-byte output', () => {
  const x = Buffer.alloc(64);
  x[63] = 3;
  const n = Buffer.alloc(64);
  n[63] = 7;
  // 3^(2^1) mod 7 = 9 mod 7 = 2
  const y = crypto.solveRsaPuzzle(x, n, 1);
  assert.equal(y.length, 64);
  assert.equal(y[63], 2);
});

// ── packet framing ──────────────────────────────────────────────────────────

test('packet framing: 11-byte server header, 13-byte client header', () => {
  const s2c = buildPacket({
    direction: 's2c',
    type: PacketType.COMMAND,
    flags: PacketFlags.NEW_PROTOCOL,
    packetId: 0x0102,
    payload: Buffer.from('serverinfo'),
  });
  assert.equal(s2c.length, TAG_LENGTH + S2C_HEADER_LENGTH + 10);
  const parsedS2c = parsePacket(s2c, 's2c');
  assert.equal(parsedS2c.packetId, 0x0102);
  assert.equal(parsedS2c.type, PacketType.COMMAND);
  assert.equal(parsedS2c.flags & PacketFlags.NEW_PROTOCOL, PacketFlags.NEW_PROTOCOL);
  assert.equal(parsedS2c.payload.toString(), 'serverinfo');

  const c2s = buildPacket({
    direction: 'c2s',
    type: PacketType.COMMAND,
    flags: PacketFlags.NEW_PROTOCOL,
    packetId: 2,
    clientId: 7,
    payload: Buffer.from('clientinit'),
  });
  assert.equal(c2s.length, TAG_LENGTH + C2S_HEADER_LENGTH + 10);
  const parsedC2s = parsePacket(c2s, 'c2s');
  assert.equal(parsedC2s.packetId, 2);
  assert.equal(parsedC2s.clientId, 7);
  assert.equal(parsedC2s.payload.toString(), 'clientinit');
});

test('MTU table: 500 bytes IPv4, 1108 bytes IPv6, whisper exempt', () => {
  assert.equal(packetMtu(false), 500);
  assert.equal(packetMtu(true), 1108);
  assert.equal(bodyMtu(false, 'c2s'), 500 - C2S_HEADER_LENGTH - TAG_LENGTH);
  assert.equal(bodyMtu(true, 's2c'), 1108 - S2C_HEADER_LENGTH - TAG_LENGTH);
});

// ── command syntax ──────────────────────────────────────────────────────────

test('command escaping round-trips the documented escapes', () => {
  const value = 'a b|c/d\\e\nf\tg\vh';
  const escaped = escapeValue(value);
  assert.equal(escaped, 'a\\sb\\pc\\/d\\\\e\\nf\\tg\\vh');
  assert.equal(unescapeValue(escaped), value);
});

test('encodeCommand builds ordered parameters and bare flags', () => {
  const line = encodeCommand('clientupdate', [
    ['client_nickname', 'probe one'],
    ['client_away', '1'],
    ['-away', ''],
  ]);
  assert.equal(line.toString(), 'clientupdate client_nickname=probe\\sone client_away=1 -away');
  const parsed = parseCommand(line);
  assert.equal(parsed.name, 'clientupdate');
  assert.equal(parsed.params.client_nickname, 'probe one');
  assert.deepEqual(parsed.flags, ['-away']);
});

test('parseCommand handles nameless rows and error lines', () => {
  const row = parseCommand(Buffer.from('clid=6 cid=2 client_nickname=probe'));
  assert.equal(row.name, '');
  assert.equal(row.params.clid, '6');
  const error = parseCommand(Buffer.from('error id=2568 msg=insufficient\\sclient\\spermissions'));
  assert.equal(error.name, 'error');
  assert.equal(error.params.id, '2568');
  assert.equal(error.params.msg, 'insufficient client permissions');
});

test('splitRows merges batch rows that omit unchanged fields', () => {
  const { name, rows } = splitRows(
    'notifycliententerview clid=1 client_nickname=a ctid=1|clid=2 client_nickname=b',
  );
  assert.equal(name, 'notifycliententerview');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { clid: '1', client_nickname: 'a', ctid: '1' });
  assert.deepEqual(rows[1], { clid: '2', client_nickname: 'b', ctid: '1' });
});

// ── QuickLZ ─────────────────────────────────────────────────────────────────

test('quicklz: uncompressed block is copied out', () => {
  // flags 0x04 = level 1, stored uncompressed; 3-byte header; size in data[2].
  const block = Buffer.concat([hex('04 00 05'), Buffer.from('hello')]);
  assert.equal(quicklzDecompress(block).toString(), 'hello');
});

test('quicklz: rejects unsupported level and truncated data', () => {
  assert.throws(() => quicklzDecompress(hex('00 00 05 68 69')), /level 1/);
  assert.throws(() => quicklzDecompress(hex('04 00 05 68')), /truncated/);
});

// ── initserver / clientinit ─────────────────────────────────────────────────

test('clientinit carries the required fields in the real client order', () => {
  const identity = handshake.createIdentity(1);
  const command = parseCommand(
    handshake.buildClientInit({
      nickname: 'probe one',
      identity,
      channelId: 1,
      serverPassword: '',
    }),
  );
  assert.equal(command.name, 'clientinit');
  assert.equal(command.params.client_nickname, 'probe one');
  assert.equal(command.params.client_default_channel, '1');
  assert.equal(command.params.client_key_offset, String(identity.offset));
  assert.ok(command.params.client_version.length > 0);
  assert.ok(command.params.client_version_sign.length > 0);
  assert.ok(command.params.hwid.length > 0);
});

test('parseInitServer reads aclid', () => {
  const parsed = handshake.parseInitServer({ aclid: '17', virtualserver_name: 'Test' });
  assert.equal(parsed.clientId, 17);
  assert.equal(parsed.serverName, 'Test');
  assert.equal(handshake.parseInitServer({}).clientId, 0);
});
// ── voice packets must be encrypted like commands ──────────────────────────

test('voice packets are EAX-encrypted like commands (unencrypted voice is dropped by the server)', () => {
  const iv = Buffer.alloc(64, 0x17);
  const mac = Buffer.alloc(8, 0x99);
  const connection = new Ts3Connection({
    host: '127.0.0.1',
    port: 9987,
    identity: handshake.createIdentity(1),
  });
  connection.session = { iv, mac };
  connection.clientId = 7;

  const payload = Buffer.from('voice payload bytes');
  const datagram = connection.encryptPacket({
    type: PacketType.VOICE,
    flags: 0,
    packetId: 0,
    payload,
  });
  // 13-byte client header: tag, packet id, client id, type/flags
  assert.equal(datagram.readUInt16BE(8), 0);
  assert.equal(datagram.readUInt16BE(10), 7);
  assert.equal(datagram[12], PacketType.VOICE, 'voice must not carry the unencrypted flag');
  assert.notDeepEqual(datagram.subarray(0, 8), mac, 'voice must not use the shared MAC payload form');

  const header = datagram.subarray(8, 13);
  const { key, nonce } = crypto.derivePacketKey({
    iv,
    packetType: PacketType.VOICE,
    generationId: 0,
    fromServer: false,
    packetId: 0,
  });
  const plaintext = crypto.eaxDecrypt({
    key,
    nonce,
    header,
    ciphertext: datagram.subarray(13),
    tag: datagram.subarray(0, 8),
  });
  assert.deepEqual(plaintext, payload);

  // ACKs stay unencrypted with the shared MAC.
  const ack = connection.encryptPacket({
    type: PacketType.ACK,
    flags: PacketFlags.UNENCRYPTED,
    packetId: 0,
    payload: Buffer.from([0, 1]),
  });
  assert.deepEqual(ack.subarray(0, 8), mac);
  assert.equal(ack[12] & PacketFlags.UNENCRYPTED, PacketFlags.UNENCRYPTED);
});

test('request() and getStats() expose the documented shapes', async () => {
  const connection = new Ts3Connection({
    host: '127.0.0.1',
    port: 9987,
    identity: handshake.createIdentity(1),
  });
  connection.serverInfoRaw = {
    virtualserver_name: 'Test',
    virtualserver_platform: 'Linux',
    virtualserver_version: '3.13.9',
    virtualserver_maxclients: '32',
    virtualserver_welcomemessage: 'hi',
  };
  connection.connectedAt = Date.now() - 5000;
  const info = await connection.request('serverinfo');
  assert.equal(info.name, 'Test');
  assert.equal(info.maxClients, 32);
  assert.equal(info.port, 9987);
  assert.ok(info.uptime >= 4);
  assert.deepEqual((await connection.request('channels')).list, []);
  assert.deepEqual((await connection.request('clients')).list, []);
  const stats = await connection.request('stats');
  for (const key of ['ping', 'loss', 'sentBytes', 'recvBytes', 'sentPackets', 'recvPackets']) {
    assert.equal(typeof stats[key], 'number', `stats.${key} must be a number`);
  }
  assert.deepEqual(connection.getStats(), stats);
  await assert.rejects(connection.request('nope'), /unknown target/);
  connection.setWhisperTargets({ channels: [1], clients: [2] }, true);
  assert.equal(connection.whisper.active, true);
  connection.setWhisperTargets(null, false);
  assert.equal(connection.whisper.active, false);
  assert.throws(() => connection.setWhisperTargets({ channels: Array(300).fill(1) }, true), /255/);
});
