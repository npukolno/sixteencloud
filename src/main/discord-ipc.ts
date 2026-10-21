import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

const SOCKET_PREFIX = 'discord-ipc-';
const MAX_SOCKET_INDEX = 9;
const MAX_CANDIDATES = 96;
const CONNECT_TIMEOUT_MS = 1500;
const REQUEST_TIMEOUT_MS = 5000;

const OPCodes = {
  HANDSHAKE: 0,
  FRAME: 1,
  CLOSE: 2,
  PING: 3,
  PONG: 4,
} as const;

interface RpcMessage {
  cmd?: string;
  evt?: string;
  nonce?: string;
  data?: any;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function encode(op: number, data: unknown): Buffer {
  const json = JSON.stringify(data);
  const length = Buffer.byteLength(json);
  const packet = Buffer.allocUnsafe(8 + length);
  packet.writeInt32LE(op, 0);
  packet.writeInt32LE(length, 4);
  packet.write(json, 8, length);
  return packet;
}

function isDirectory(entry: fs.Dirent, parent: string): boolean {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    return fs.statSync(path.join(parent, entry.name)).isDirectory();
  } catch {
    return false;
  }
}

function pushCandidate(out: string[], seen: Set<string>, value: string): void {
  if (out.length >= MAX_CANDIDATES) return;
  const key = process.platform === 'win32' ? value.toLowerCase() : value;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(value);
}

function scanSocketDir(base: string, out: string[], seen: Set<string>): void {
  for (let index = 0; index <= MAX_SOCKET_INDEX; index += 1) {
    pushCandidate(out, seen, path.join(base, `${SOCKET_PREFIX}${index}`));
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(base, entry.name);
    if (entry.name.startsWith(SOCKET_PREFIX)) {
      pushCandidate(out, seen, fullPath);
      continue;
    }
    // Flatpak/Snap/custom clients keep the same socket one level deeper.
    if (isDirectory(entry, base) && /(discord|vesktop|webcord|armcord|legcord|equibop|dorion|abaddon|snap\.)/i.test(entry.name)) {
      for (let index = 0; index <= MAX_SOCKET_INDEX; index += 1) {
        pushCandidate(out, seen, path.join(fullPath, `${SOCKET_PREFIX}${index}`));
      }
      try {
        for (const nested of fs.readdirSync(fullPath, { withFileTypes: true })) {
          if (nested.name.startsWith(SOCKET_PREFIX)) {
            pushCandidate(out, seen, path.join(fullPath, nested.name));
          }
        }
      } catch {
        /* unreadable sandbox runtime — skip */
      }
    }
  }
}

function posixBaseDirectories(): string[] {
  const bases: string[] = [];
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const home = process.env.HOME || os.homedir();

  if (process.env.XDG_RUNTIME_DIR) {
    bases.push(process.env.XDG_RUNTIME_DIR, path.join(process.env.XDG_RUNTIME_DIR, 'app'));
  }
  if (uid !== null) {
    const runtimeDir = `/run/user/${uid}`;
    bases.push(runtimeDir, path.join(runtimeDir, 'app'));
  }
  bases.push(os.tmpdir(), '/tmp', '/var/tmp');
  if (home) bases.push(path.join(home, '.var', 'app'));

  return bases.filter((value, index) => value && bases.indexOf(value) === index);
}

/**
 * Every desktop Discord build speaks the same IPC protocol. The socket/pipe
 * location differs per install type: native, portable, Flatpak, Snap and the
 * various custom clients. Scan all known locations instead of trusting a
 * single prefix (which is what discord-rpc does).
 */
export function discoverDiscordIpcPaths(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const explicit = [process.env.SIXTEENCLOUD_DISCORD_IPC, process.env.DISCORD_IPC_PATH];
  for (const value of explicit) {
    if (value && value.trim()) pushCandidate(out, seen, value.trim());
  }

  if (process.platform === 'win32') {
    for (let index = 0; index <= MAX_SOCKET_INDEX; index += 1) {
      pushCandidate(out, seen, `\\\\.\\pipe\\${SOCKET_PREFIX}${index}`);
    }
    return out;
  }

  for (const base of posixBaseDirectories()) {
    scanSocketDir(base, out, seen);
  }
  return out;
}

export class DiscordIpcClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private readBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private pending = new Map<string, PendingRequest>();
  private connected = false;
  private closing = false;

  constructor(private readonly clientId: string) {
    super();
  }

  get endpoint(): string | null {
    return this.socket ? this.currentPath : null;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  private currentPath: string | null = null;

  async connect(preferredPath?: string | null): Promise<boolean> {
    this.closing = false;
    const candidates = discoverDiscordIpcPaths();
    if (preferredPath) {
      candidates.unshift(preferredPath);
    }
    const tried = new Set<string>();
    for (const candidate of candidates) {
      const key = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
      if (tried.has(key)) continue;
      tried.add(key);
      if (await this.tryConnect(candidate)) {
        this.currentPath = candidate;
        this.connected = true;
        this.emit('ready');
        return true;
      }
      if (this.closing) break;
    }
    return false;
  }

  private tryConnect(socketPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      let buffer = Buffer.alloc(0);
      const socket = net.createConnection(socketPath);
      const finish = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!ok) {
          socket.removeAllListeners();
          socket.destroy();
        }
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), CONNECT_TIMEOUT_MS);

      const onData = (chunk: Buffer): void => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 8) {
          const op = buffer.readInt32LE(0);
          const length = buffer.readInt32LE(4);
          if (length < 0 || length > 1024 * 1024) {
            finish(false);
            return;
          }
          if (buffer.length < 8 + length) return;
          const raw = buffer.subarray(8, 8 + length).toString('utf8');
          buffer = buffer.subarray(8 + length);
          let message: RpcMessage;
          try {
            message = JSON.parse(raw);
          } catch {
            continue;
          }
          if (op === OPCodes.FRAME && message.evt === 'READY') {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.removeListener('data', onData);
            socket.removeListener('error', onError);
            socket.removeListener('close', onClose);
            this.adopt(socket, buffer);
            resolve(true);
            return;
          }
          if (op === OPCodes.CLOSE) {
            finish(false);
            return;
          }
        }
      };
      const onError = (): void => finish(false);
      const onClose = (): void => finish(false);

      socket.once('connect', () => {
        socket.setNoDelay(true);
        socket.write(encode(OPCodes.HANDSHAKE, { v: 1, client_id: this.clientId }));
      });
      socket.on('data', onData);
      socket.once('error', onError);
      socket.once('close', onClose);
    });
  }

  private adopt(socket: net.Socket, leftover: Buffer): void {
    this.socket = socket;
    this.readBuffer = leftover;
    socket.on('data', this.onData);
    socket.once('error', this.onClose);
    socket.once('close', this.onClose);
    if (this.readBuffer.length > 0) {
      this.processBuffer();
    }
  }

  private onData = (chunk: Buffer): void => {
    this.readBuffer = Buffer.concat([this.readBuffer, chunk]);
    this.processBuffer();
  };

  private processBuffer(): void {
    while (this.readBuffer.length >= 8) {
      const op = this.readBuffer.readInt32LE(0);
      const length = this.readBuffer.readInt32LE(4);
      if (length < 0 || length > 1024 * 1024) {
        this.onClose();
        return;
      }
      if (this.readBuffer.length < 8 + length) return;
      const raw = this.readBuffer.subarray(8, 8 + length).toString('utf8');
      this.readBuffer = this.readBuffer.subarray(8 + length);

      let message: RpcMessage;
      try {
        message = JSON.parse(raw);
      } catch {
        continue;
      }
      this.handleMessage(op, message);
    }
  }

  private handleMessage(op: number, message: RpcMessage): void {
    if (op === OPCodes.PING) {
      this.sendRaw(OPCodes.PONG, message.data ?? {});
      return;
    }
    if (op === OPCodes.CLOSE) {
      this.onClose();
      return;
    }
    if (op !== OPCodes.FRAME) return;

    if (message.nonce && this.pending.has(message.nonce)) {
      const pending = this.pending.get(message.nonce)!;
      this.pending.delete(message.nonce);
      clearTimeout(pending.timer);
      if (message.evt === 'ERROR') {
        const error = new Error(message.data?.message || 'Discord RPC error') as Error & { code?: number };
        error.code = message.data?.code;
        pending.reject(error);
      } else {
        pending.resolve(message.data);
      }
      return;
    }
    this.emit('dispatch', message);
  }

  private sendRaw(op: number, data: unknown): void {
    if (!this.socket || this.socket.destroyed) return;
    try {
      this.socket.write(encode(op, data));
    } catch {
      /* socket closes and reconnects */
    }
  }

  request(cmd: string, args: Record<string, unknown>): Promise<any> {
    if (!this.socket || this.socket.destroyed || !this.connected) {
      return Promise.reject(new Error('Discord RPC is not connected'));
    }
    const nonce = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        reject(new Error(`Discord RPC request timed out: ${cmd}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(nonce, { resolve, reject, timer });
      this.sendRaw(OPCodes.FRAME, { cmd, args, evt: null, nonce });
    });
  }

  async setActivity(activity: Record<string, unknown> | null): Promise<void> {
    const args: Record<string, unknown> = { pid: process.pid };
    if (activity) args.activity = activity;
    await this.request('SET_ACTIVITY', args);
  }

  disconnect(): void {
    this.closing = true;
    this.connected = false;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Discord RPC disconnected'));
    }
    this.pending.clear();
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      try {
        socket.write(encode(OPCodes.CLOSE, {}));
      } catch {
        /* already gone */
      }
      socket.destroy();
    }
    this.readBuffer = Buffer.alloc(0);
    this.currentPath = null;
  }

  private onClose = (): void => {
    if (!this.connected && !this.socket) return;
    this.connected = false;
    this.socket = null;
    this.currentPath = null;
    this.readBuffer = Buffer.alloc(0);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Discord RPC connection closed'));
    }
    this.pending.clear();
    this.emit('close');
  };
}
