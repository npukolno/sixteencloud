import { app } from 'electron';
import path from 'path';
import fs from 'fs';

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB
const TRUNCATE_TO = 2 * 1024 * 1024; // 2 MB

let logFilePath: string | null = null;
let consoleUsable = true;

// stdout/stderr can disappear when the launching terminal or service closes
// (write EIO). A dying console must never take the main process down with it.
for (const stream of [process.stdout, process.stderr]) {
  stream?.on?.('error', () => {
    consoleUsable = false;
  });
}

function getLogFilePath(): string {
  if (logFilePath) return logFilePath;
  let logsDir = '';
  try {
    logsDir = app.getPath('logs');
  } catch {
    logsDir = path.join(app.getPath('userData'), 'logs');
  }
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  logFilePath = path.join(logsDir, 'main.log');
  return logFilePath;
}

function rotateIfNeeded(filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) return;
    const stats = fs.statSync(filePath);
    if (stats.size > MAX_LOG_SIZE) {
      const buf = Buffer.alloc(TRUNCATE_TO);
      const fd = fs.openSync(filePath, 'r');
      const readFrom = stats.size - TRUNCATE_TO;
      fs.readSync(fd, buf, 0, TRUNCATE_TO, readFrom);
      fs.closeSync(fd);
      // Find the first newline so we don't start mid-line
      const firstNewline = buf.indexOf(10); // '\n'
      const clean = firstNewline >= 0 ? buf.subarray(firstNewline + 1) : buf;
      fs.writeFileSync(filePath, clean);
    }
  } catch {
    // Rotation failure should never crash the app
  }
}

export function log(level: string, ...args: any[]): void {
  const timestamp = new Date().toISOString();
  const message = args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ');
  const line = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;

  // Always mirror to console, unless the stream already failed
  if (consoleUsable) {
    try {
      console.log(line.trimEnd());
    } catch {
      consoleUsable = false;
    }
  }

  try {
    const filePath = getLogFilePath();
    rotateIfNeeded(filePath);
    fs.appendFileSync(filePath, line, 'utf-8');
  } catch {
    // File write failure should never crash the app
  }
}

export function logInfo(...args: any[]): void {
  log('info', ...args);
}

export function logError(...args: any[]): void {
  log('error', ...args);
}

export function logWarn(...args: any[]): void {
  log('warn', ...args);
}
