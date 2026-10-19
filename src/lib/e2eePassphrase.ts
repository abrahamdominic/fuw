const E2EE_PASSPHRASE_PREFIX = 'e2ep:v1:';

function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

const masterKeyCache = new Map<string, CryptoKey>();
const PASS_SALT_KEY = 'fuw_e2e_pass_salt';

async function getOrCreateSalt(): Promise<ArrayBuffer> {
  const stored = localStorage.getItem(PASS_SALT_KEY);
  if (stored) {
    return base64ToArrayBuffer(stored);
  }
  const salt = window.crypto.getRandomValues(new Uint8Array(32));
  localStorage.setItem(PASS_SALT_KEY, arrayBufferToBase64(salt));
  return salt.buffer;
}

async function deriveMasterKey(passphrase: string): Promise<CryptoKey> {
  const cached = masterKeyCache.get(passphrase);
  if (cached) return cached;

  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const salt = await getOrCreateSalt();
  const masterKey = await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  masterKeyCache.set(passphrase, masterKey);
  return masterKey;
}

async function deriveConversationKey(masterKey: CryptoKey, conversationId: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const hkdfKey = await window.crypto.subtle.importKey(
    'raw',
    await window.crypto.subtle.exportKey('raw', masterKey),
    'HKDF',
    false,
    ['deriveKey']
  ).catch(async () => {
    // Fallback: use master key differently
    return await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: enc.encode('conv-' + conversationId),
        iterations: 10000,
        hash: 'SHA-256',
      },
      await window.crypto.subtle.importKey('raw', enc.encode('mk'), 'PBKDF2', false, ['deriveKey']),
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  });

  const derived = await window.crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: enc.encode('fuw-e2ep-v1'),
      info: enc.encode(conversationId),
    },
    masterKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  return derived;
}

export async function encryptWithPassphrase(plaintext: string, conversationId: string, passphrase: string): Promise<string> {
  try {
    if (!window.crypto?.subtle) return plaintext;
    const master = await deriveMasterKey(passphrase);
    const key = await deriveConversationKey(master, conversationId);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const ct = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
    const payload = JSON.stringify({ iv: arrayBufferToBase64(iv), ct: arrayBufferToBase64(ct) });
    return E2EE_PASSPHRASE_PREFIX + window.btoa(payload);
  } catch (e) {
    console.warn('[E2EP] encrypt failed', e);
    return plaintext;
  }
}

export async function decryptWithPassphrase(ciphertext: string, conversationId: string, passphrase: string): Promise<{ text: string; isEncrypted: boolean }> {
  if (!ciphertext.startsWith(E2EE_PASSPHRASE_PREFIX)) {
    return { text: ciphertext, isEncrypted: false };
  }
  try {
    if (!window.crypto?.subtle) return { text: '[Unsupported]', isEncrypted: true };
    const master = await deriveMasterKey(passphrase);
    const key = await deriveConversationKey(master, conversationId);
    const payload = JSON.parse(window.atob(ciphertext.slice(E2EE_PASSPHRASE_PREFIX.length)));
    const iv = new Uint8Array(base64ToArrayBuffer(payload.iv));
    const ct = base64ToArrayBuffer(payload.ct);
    const pt = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return { text: new TextDecoder().decode(pt), isEncrypted: true };
  } catch (e) {
    return { text: '[Decryption failed - wrong passphrase?]', isEncrypted: true };
  }
}
