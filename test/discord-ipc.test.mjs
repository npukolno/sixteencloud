import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DiscordIpcClient,
  discoverDiscordIpcPaths,
} from '../dist/main/discord-ipc.js';

function encode(op, data) {
  const json = JSON.stringify(data);
  const length = Buffer.byteLength(json);
  const packet = Buffer.alloc(8 + length);
  packet.writeInt32LE(op, 0);
  packet.writeInt32LE(length, 4);
  packet.write(json, 8, length);
  return packet;
}

function readFrames(buffer, onFrame) {
  let rest = buffer;
  while (rest.length >= 8) {
    const op = rest.readInt32LE(0);
    const length = rest.readInt32LE(4);
    if (rest.length < 8 + length) break;
    const raw = rest.subarray(8, 8 + length).toString('utf8');
    rest = rest.subarray(8 + length);
    onFrame(op, JSON.parse(raw));
  }
  return rest;
}

test('Discord IPC handshake, activity and clear work over a socket', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-rpc-'));
  const socketPath = path.join(dir, 'discord-ipc-0');
  const requests = [];
  let handshakeClientId = '';
  let socket = null;

  const server = net.createServer((connection) => {
    socket = connection;
    let buffer = Buffer.alloc(0);
    connection.on('data', (chunk) => {
      buffer = readFrames(Buffer.concat([buffer, chunk]), (op, message) => {
        if (op === 0) {
          handshakeClientId = message.client_id;
          connection.write(encode(1, {
            cmd: 'DISPATCH',
            evt: 'READY',
            data: { v: 1, config: {}, user: { id: '1', username: 'tester' } },
          }));
          return;
        }
        if (op === 1 && message.cmd === 'SET_ACTIVITY') {
          requests.push(message);
          connection.write(encode(1, {
            cmd: 'SET_ACTIVITY',
            evt: null,
            nonce: message.nonce,
            data: {},
          }));
        }
      });
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });

  const client = new DiscordIpcClient('1488109970095607908');
  try {
    assert.equal(await client.connect(socketPath), true);
    assert.equal(client.isConnected, true);
    assert.equal(handshakeClientId, '1488109970095607908');
    assert.equal(client.endpoint, socketPath);

    await client.setActivity({ type: 2, details: 'Test track' });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].args.pid, process.pid);
    assert.equal(requests[0].args.activity.type, 2);
    assert.equal(requests[0].args.activity.details, 'Test track');

    await client.setActivity(null);
    assert.equal(requests.length, 2);
    assert.equal('activity' in requests[1].args, false);
  } finally {
    client.disconnect();
    if (socket) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Discord IPC discovery covers runtime, Flatpak and custom client directories', () => {
  const previousOverride = process.env.SIXTEENCLOUD_DISCORD_IPC;
  const previousRuntime = process.env.XDG_RUNTIME_DIR;
  const customPath = process.platform === 'win32'
    ? '\\\\.\\pipe\\custom-discord-ipc'
    : '/tmp/custom-discord-ipc';
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-rpc-discovery-'));
  const flatpakDir = path.join(runtimeDir, 'app', 'com.discordapp.Discord');
  fs.mkdirSync(flatpakDir, { recursive: true });

  try {
    process.env.SIXTEENCLOUD_DISCORD_IPC = customPath;
    if (process.platform !== 'win32') {
      process.env.XDG_RUNTIME_DIR = runtimeDir;
    }
    const paths = discoverDiscordIpcPaths();
    assert.equal(paths[0], customPath);
    if (process.platform !== 'win32') {
      assert.equal(paths.includes(path.join(runtimeDir, 'discord-ipc-0')), true);
      assert.equal(paths.includes(path.join(flatpakDir, 'discord-ipc-0')), true);
    }
  } finally {
    if (previousOverride === undefined) delete process.env.SIXTEENCLOUD_DISCORD_IPC;
    else process.env.SIXTEENCLOUD_DISCORD_IPC = previousOverride;
    if (previousRuntime === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = previousRuntime;
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }
});
