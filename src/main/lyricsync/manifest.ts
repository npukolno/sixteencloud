// What lyricsync downloads on demand. Nothing here ships in the app binary: the user
// downloads the engine and a language pack from the Sync tab and can delete them.
// Every file is pinned (exact revision / version) and verified by hash after download.

export const ORT_VERSION = '1.31.1';

export interface PackFile {
  /** Path inside the pack folder. */
  path: string;
  url: string;
  size: number;
  sha256?: string;
  /** npm tarball: verify with this SRI sha512 and extract only matching entries. */
  integrity?: string;
  extract?: { strip: string; include: (p: string) => boolean; into: string };
}

export interface Pack {
  id: string;
  kind: 'runtime' | 'separator' | 'language';
  files: PackFile[];
}

const HF = 'https://huggingface.co';
const NPM = 'https://registry.npmjs.org';

function nativeTarget(): string | null {
  const key = `${process.platform}/${process.arch}`;
  // onnxruntime-node 1.31 ships no darwin/x64 binary: Intel Macs use the WebAssembly build.
  return ['linux/x64', 'linux/arm64', 'win32/x64', 'win32/arm64', 'darwin/arm64'].includes(key) ? key : null;
}

const COMMON: PackFile = {
  path: 'onnxruntime-common.tgz',
  url: `${NPM}/onnxruntime-common/-/onnxruntime-common-${ORT_VERSION}.tgz`,
  size: 72322,
  integrity: 'sha512-F+nnYNiQtmNJ95V6R/isBJqiVpdANCrsMEg1OaF+Bkbl3GAtzWLR7Ng17Ld0QtYtYJyotOHPJzOQn1Y6PLZjpg==',
  extract: { strip: 'package/', include: (p) => p === 'package.json' || p.startsWith('dist/cjs/'), into: 'node_modules/onnxruntime-common' },
};

export function runtimePack(): Pack {
  const target = nativeTarget();
  if (target) {
    return {
      id: 'runtime-native',
      kind: 'runtime',
      files: [COMMON, {
        path: 'onnxruntime-node.tgz',
        url: `${NPM}/onnxruntime-node/-/onnxruntime-node-${ORT_VERSION}.tgz`,
        size: 115391311,
        integrity: 'sha512-ijnSghbDHVWaQ2nDPmVccPlCHI8kH1Mx1aJ4a/qzRP16bBcVs4E3EqZQKZCkhWnbqN1tuQWxagimFtDpbPYYQw==',
        extract: {
          strip: 'package/',
          include: (p) => p === 'package.json' || (p.startsWith('dist/') && p.endsWith('.js')) || p.startsWith(`bin/napi-v6/${target}/`),
          into: 'node_modules/onnxruntime-node',
        },
      }],
    };
  }
  return wasmPack();
}

export function wasmPack(): Pack {
  const JSD = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist`;
  const dir = 'node_modules/onnxruntime-web/dist';
  return {
    id: 'runtime-wasm',
    kind: 'runtime',
    files: [COMMON,
      { path: `${dir}/ort.node.min.js`, url: `${JSD}/ort.node.min.js`, size: 29279, sha256: 'c42472bfa6c72844228246c58be7f2f11cafb8f3fa1b7ddf366bc9318cb1da89' },
      { path: `${dir}/ort-wasm-simd-threaded.mjs`, url: `${JSD}/ort-wasm-simd-threaded.mjs`, size: 24738, sha256: '30ed0b5cd1182ede931fea448afb567d4dc705ec957af09f108a2be5f770dac3' },
      { path: `${dir}/ort-wasm-simd-threaded.wasm`, url: `${JSD}/ort-wasm-simd-threaded.wasm`, size: 14848852, sha256: '4b884c203b0fa48d057be3332c65513ff85aa3c5bddd6946acc0fab7ecda001d' },
    ],
  };
}

export const SEPARATOR: Pack = {
  id: 'separator',
  kind: 'separator',
  files: [{
    path: 'UVR-MDX-NET-Voc_FT.onnx',
    url: 'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Voc_FT.onnx',
    size: 66762490, sha256: '534b2070fcc7df514b13ef660dc8cbb328679c2374d04354a5c42bb14ecce111',
  }],
};

const XLSR_RU = `${HF}/onnx-community/wav2vec2-large-xlsr-53-russian-ONNX/resolve/df5ba1d9e0f9a34c44eec437b441f4ae43c842eb`;
const GIGA = `${HF}/istupakov/gigaam-v3-onnx/resolve/322c3b29492673eb7d0b434bfa9dfb8653e34d02`;
const W2V_EN = `${HF}/Xenova/wav2vec2-base-960h/resolve/a19f851b3d42865797e410752b4c570c871e4825`;

export const LANGUAGES: Record<'ru' | 'en', Pack> = {
  // Russian: ensemble of XLSR-53 (Common Voice) and Sber GigaAM v3, both int8.
  // Checked on hand-marked tracks: int8 ensemble is as accurate as fp32 at a quarter of the size.
  ru: {
    id: 'lang-ru',
    kind: 'language',
    files: [
      { path: 'xlsr.onnx', url: `${XLSR_RU}/onnx/model_int8.onnx`, size: 317349889, sha256: 'cbdb8961f4eea83fce782311e3ab6d6581aeceeb8caefa44518a9e73ed35d18a' },
      { path: 'xlsr.vocab.json', url: `${XLSR_RU}/vocab.json`, size: 468, sha256: '94af9bc439fe8a64657b1898505fe2bd1a78e2ef8ad24b7dbdc3c6f921cf0953' },
      { path: 'giga.onnx', url: `${GIGA}/v3_ctc.int8.onnx`, size: 224721181, sha256: 'ceb61454e2e1a2dec5872cbac1de0fe0a4271d1148f6b26b5bda53ff30a12acd' },
      { path: 'giga.vocab.txt', url: `${GIGA}/v3_vocab.txt`, size: 198, sha256: 'a9143c30844d3c0bee3e9e927e4084774eb1b9eeaafc473b2c4521e4911a7c07' },
    ],
  },
  // English: wav2vec2-base-960h (fp32, the variant checked by ear).
  en: {
    id: 'lang-en',
    kind: 'language',
    files: [
      { path: 'xlsr.onnx', url: `${W2V_EN}/onnx/model.onnx`, size: 377887594, sha256: 'e46614273f03ff4b87923a965e417fa72004825522cb007c9c25633b8475490d' },
      { path: 'xlsr.vocab.json', url: `${W2V_EN}/vocab.json`, size: 358, sha256: '4178db26b3c7570f6a47f14ac6a1c7b32950b8c2800fb097287e53776934f1c5' },
    ],
  },
};

export type Lang = keyof typeof LANGUAGES;

export function packSize(p: Pack): number {
  return p.files.reduce((s, f) => s + (f.size || 0), 0);
}
