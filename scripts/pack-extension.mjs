#!/usr/bin/env node
/**
 * SuenWeb Extension Packer
 * Builds:
 *  - public/extension/suenweb.crx & extension/suenweb.crx (Chrome CRX3 format)
 *  - public/extension/suenweb-firefox.xpi & extension/suenweb-firefox.xpi (Firefox XPI)
 *  - public/extension/suenweb-extension-chrome.zip (Source ZIP)
 *  - public/extension/suenweb-extension-firefox.zip (Source ZIP)
 *  - src/extensions.ts (Cloudflare Workers embedded assets)
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { zipSync, strToU8 } from 'fflate';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function readText(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function readBuffer(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath));
}

// 1. Prepare files for Chrome & Firefox
const manifestChrome = readText('extension/manifest.json');
const manifestFirefox = readText('extension/manifest_firefox.json');
const backgroundJs = readText('extension/background.js');
const popupHtml = readText('extension/popup.html');
const popupJs = readText('extension/popup.js');
const iconSvg = readText('extension/icons/icon.svg');
const icon16 = readBuffer('extension/icons/icon-16.png');
const icon48 = readBuffer('extension/icons/icon-48.png');
const icon128 = readBuffer('extension/icons/icon-128.png');

const chromeFiles = {
  'manifest.json': strToU8(manifestChrome),
  'background.js': strToU8(backgroundJs),
  'popup.html': strToU8(popupHtml),
  'popup.js': strToU8(popupJs),
  'icons/icon-16.png': new Uint8Array(icon16),
  'icons/icon-48.png': new Uint8Array(icon48),
  'icons/icon-128.png': new Uint8Array(icon128),
  'icons/icon.svg': strToU8(iconSvg),
};

const firefoxFiles = {
  'manifest.json': strToU8(manifestFirefox),
  'background.js': strToU8(backgroundJs),
  'popup.html': strToU8(popupHtml),
  'popup.js': strToU8(popupJs),
  'icons/icon-16.png': new Uint8Array(icon16),
  'icons/icon-48.png': new Uint8Array(icon48),
  'icons/icon-128.png': new Uint8Array(icon128),
  'icons/icon.svg': strToU8(iconSvg),
};

// 2. Generate ZIPs
const chromeZip = Buffer.from(zipSync(chromeFiles));
const firefoxZip = Buffer.from(zipSync(firefoxFiles));

// 3. Load or generate private key
let privateKeyPem = process.env.CRX_PRIVATE_KEY;
const keyFile = path.join(ROOT, 'extension/key.pem');

if (!privateKeyPem) {
  if (fs.existsSync(keyFile)) {
    privateKeyPem = fs.readFileSync(keyFile, 'utf8');
  } else {
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKeyPem = privateKey;
    fs.writeFileSync(keyFile, privateKeyPem, 'utf8');
    console.log('[Pack] Generated new extension/key.pem');
  }
}

// 4. Build CRX3
function encodeVarint(n) {
  const bytes = [];
  while (n > 0x7f) {
    bytes.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  bytes.push(n & 0x7f);
  return Buffer.from(bytes);
}

function pbField(tag, wireType, data) {
  const key = encodeVarint((tag << 3) | wireType);
  if (wireType === 2) {
    return Buffer.concat([key, encodeVarint(data.length), Buffer.isBuffer(data) ? data : Buffer.from(data)]);
  }
  return Buffer.concat([key, Buffer.isBuffer(data) ? data : Buffer.from(data)]);
}

function packCrx3(zipBuffer, privKeyPem) {
  const privKey = crypto.createPrivateKey(privKeyPem);
  const pubKey = crypto.createPublicKey(privKey);
  const derPub = pubKey.export({ type: 'spki', format: 'der' });

  const crxId = crypto.createHash('sha256').update(derPub).digest().subarray(0, 16);
  const signedHeaderData = pbField(10000, 2, pbField(10000, 2, crxId));

  const prefix = Buffer.from('CRX3 SignedData\x00', 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(signedHeaderData.length, 0);

  const toSign = Buffer.concat([prefix, lenBuf, signedHeaderData, zipBuffer]);
  const sig = crypto.sign('sha256', toSign, privKey);

  const keyProof = Buffer.concat([
    pbField(1, 2, derPub),
    pbField(2, 2, sig),
  ]);

  const crxHeader = Buffer.concat([
    pbField(2, 2, keyProof),
    pbField(10000, 2, signedHeaderData),
  ]);

  const headerLenBuf = Buffer.alloc(4);
  headerLenBuf.writeUInt32LE(crxHeader.length, 0);

  const magic = Buffer.from('Cr24');
  const version = Buffer.alloc(4);
  version.writeUInt32LE(3, 0);

  const crxBuffer = Buffer.concat([magic, version, headerLenBuf, crxHeader, zipBuffer]);

  // Extension ID string in Chrome hex-alphabet
  let extId = '';
  for (let i = 0; i < 16; i++) {
    const b = crxId[i];
    extId += String.fromCharCode(97 + ((b >> 4) & 0x0f));
    extId += String.fromCharCode(97 + (b & 0x0f));
  }

  return { crxBuffer, extId };
}

const { crxBuffer, extId } = packCrx3(chromeZip, privateKeyPem);

// 5. Write outputs
const publicExtDir = path.join(ROOT, 'public/extension');
const extDir = path.join(ROOT, 'extension');
if (!fs.existsSync(publicExtDir)) fs.mkdirSync(publicExtDir, { recursive: true });

// CRX
fs.writeFileSync(path.join(publicExtDir, 'suenweb.crx'), crxBuffer);
fs.writeFileSync(path.join(extDir, 'suenweb.crx'), crxBuffer);

// XPI
fs.writeFileSync(path.join(publicExtDir, 'suenweb-firefox.xpi'), firefoxZip);
fs.writeFileSync(path.join(extDir, 'suenweb-firefox.xpi'), firefoxZip);

// ZIP
fs.writeFileSync(path.join(publicExtDir, 'suenweb-extension-chrome.zip'), chromeZip);
fs.writeFileSync(path.join(publicExtDir, 'suenweb-extension-firefox.zip'), firefoxZip);

console.log(`✅ Packaged suenweb.crx (${(crxBuffer.length / 1024).toFixed(1)} KB) - Extension ID: ${extId}`);
console.log(`✅ Packaged suenweb-firefox.xpi (${(firefoxZip.length / 1024).toFixed(1)} KB)`);

// 6. Regenerate src/extensions.ts
const lit = s => JSON.stringify(s);
const outTs = `// AUTO-GENERATED by scripts/pack-extension.mjs — do not edit by hand.
// Edit the source files under extension/ then run: node scripts/pack-extension.mjs
import { zipSync, strToU8 } from 'fflate';

const MANIFEST_CHROME = ${lit(manifestChrome)};
const MANIFEST_FIREFOX = ${lit(manifestFirefox)};
const BACKGROUND_JS = ${lit(backgroundJs)};
const POPUP_HTML = ${lit(popupHtml)};
const POPUP_JS = ${lit(popupJs)};
const ICON_SVG = ${lit(iconSvg)};
const ICON_16_B64 = ${lit(icon16.toString('base64'))};
const ICON_48_B64 = ${lit(icon48.toString('base64'))};
const ICON_128_B64 = ${lit(icon128.toString('base64'))};
const CRX_B64 = ${lit(crxBuffer.toString('base64'))};
const XPI_B64 = ${lit(firefoxZip.toString('base64'))};

export const EXTENSION_ID = ${lit(extId)};

function b64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    u8[i] = bin.charCodeAt(i);
  }
  return u8;
}

export function createExtensionZip(browserType: 'chrome' | 'firefox'): Uint8Array {
  const manifest = browserType === 'chrome' ? MANIFEST_CHROME : MANIFEST_FIREFOX;

  const files = {
    'manifest.json': strToU8(manifest),
    'background.js': strToU8(BACKGROUND_JS),
    'popup.html': strToU8(POPUP_HTML),
    'popup.js': strToU8(POPUP_JS),
    'icons/icon-16.png': b64ToU8(ICON_16_B64),
    'icons/icon-48.png': b64ToU8(ICON_48_B64),
    'icons/icon-128.png': b64ToU8(ICON_128_B64),
    'icons/icon.svg': strToU8(ICON_SVG),
  };

  return zipSync(files);
}

export function getExtensionCrx(): Uint8Array {
  return b64ToU8(CRX_B64);
}

export function getExtensionXpi(): Uint8Array {
  return b64ToU8(XPI_B64);
}
`;

fs.writeFileSync(path.join(ROOT, 'src/extensions.ts'), outTs);
console.log('✅ src/extensions.ts regenerated successfully');
