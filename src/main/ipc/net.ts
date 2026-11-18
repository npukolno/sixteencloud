import { net } from 'electron';
import fs from 'fs';
import { CHROME_UA } from '../../shared/constants';

/** Electron's net.fetch with our UA: honours session cookies and the proxy. */
export function eFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const headers = new Headers(opts.headers);
  if (!headers.has('User-Agent')) headers.set('User-Agent', CHROME_UA);
  return net.fetch(url, { ...opts, headers });
}

export function fetchWithTimeout(url: string, timeoutMs: number, opts: RequestInit = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    eFetch(url, opts).then((r) => { clearTimeout(timer); resolve(r); }).catch((e) => { clearTimeout(timer); reject(e); });
  });
}

/** Read a whole (small) response body, refusing anything over maxBytes. */
export async function readResponseBuffer(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new Error(`Response exceeds ${maxBytes} byte limit`);
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error(`Response exceeds ${maxBytes} byte limit`);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      const chunk = Buffer.from(part.value);
      total += chunk.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Response exceeds ${maxBytes} byte limit`);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

/**
 * Stream a response to a new file with backpressure and a size limit.
 * The file is created exclusively (`wx`); on any failure the partial file is
 * left for the caller to remove, so a broken download never looks complete.
 * Returns the number of bytes written.
 */
export async function streamResponseToFile(response: Response, filePath: string, maxBytes: number): Promise<number> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new Error(`Response exceeds ${maxBytes} byte limit`);
  if (!response.body) throw new Error('Response body unavailable');

  const output = fs.createWriteStream(filePath, { flags: 'wx' });
  const reader = response.body.getReader();
  let total = 0;
  let outputError: Error | undefined;
  const onOutputError = (error: Error) => { outputError = error; };
  // Keep a listener for the whole transfer: createWriteStream can emit an
  // asynchronous open/write error while no drain/end handler is installed.
  output.on('error', onOutputError);

  const waitForDrain = (): Promise<void> => new Promise((resolve, reject) => {
    if (outputError) { reject(outputError); return; }
    const onDrain = () => { output.removeListener('error', onError); resolve(); };
    const onError = (error: Error) => { output.removeListener('drain', onDrain); reject(error); };
    output.once('drain', onDrain);
    output.once('error', onError);
  });

  const finish = (): Promise<void> => new Promise((resolve, reject) => {
    if (outputError) { reject(outputError); return; }
    const onError = (error: Error) => reject(error);
    output.once('error', onError);
    output.end(() => { output.removeListener('error', onError); resolve(); });
  });

  try {
    while (true) {
      if (outputError) throw outputError;
      const part = await reader.read();
      if (part.done) break;
      const chunk = Buffer.from(part.value);
      total += chunk.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Response exceeds ${maxBytes} byte limit`);
      }
      if (!output.write(chunk)) await waitForDrain();
      if (outputError) throw outputError;
    }
    await finish();
    return total;
  } catch (error) {
    try { await reader.cancel(); } catch { /* response already closed */ }
    const closePromise = output.closed
      ? Promise.resolve()
      : new Promise<void>(resolve => output.once('close', resolve));
    output.destroy();
    await closePromise;
    throw error;
  } finally {
    reader.releaseLock();
    output.removeListener('error', onOutputError);
  }
}

/** Read the first bytes of a file (e.g. to sniff an HLS playlist). */
export function readFileHead(filePath: string, length: number): Buffer {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(length);
    const read = fs.readSync(fd, buf, 0, length, 0);
    return buf.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}
