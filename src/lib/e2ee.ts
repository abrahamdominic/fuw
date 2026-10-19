// e2ee.ts — Hybrid encryption support (legacy HKDF AES-GCM + Signal Protocol envelope)
const E2EE_PREFIX = 'e2e:v1:';
const SIGNAL_PREFIX = 'sig:v1:';

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

const conversationKeyCache = new Map<string, CryptoKey>();

export async function getConversationKey(conversationId: string): Promise<CryptoKey> {
  const cached = conversationKeyCache.get(conversationId);
  if (cached) return cached;

  const enc = new TextEncoder();
  const rawKeyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(`fuw-e2e-channel:${conversationId}`),
    'HKDF',
    false,
    ['deriveKey']
  );

  const derivedKey = await window.crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: enc.encode('fuw-campus-hub-v1-salt'),
      info: enc.encode(`conversation:${conversationId}`),
    },
    rawKeyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  conversationKeyCache.set(conversationId, derivedKey);
  return derivedKey;
}

export async function encryptMessage(
  plaintext: string,
  conversationId: string
): Promise<string> {
  try {
    if (!window.crypto?.subtle) return plaintext;
    const key = await getConversationKey(conversationId);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const encoded = enc.encode(plaintext);

    const ciphertext = await window.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      encoded
    );

    const payload = JSON.stringify({
      iv: arrayBufferToBase64(iv),
      ct: arrayBufferToBase64(ciphertext),
    });

    return `${E2EE_PREFIX}${window.btoa(payload)}`;
  } catch (err) {
    console.warn('[E2EE] Encryption fallback:', err);
    return plaintext;
  }
}

export async function decryptMessage(
  ciphertextOrPlain: string,
  conversationId: string,
  senderId?: string
): Promise<{ text: string; isEncrypted: boolean }> {
  if (!ciphertextOrPlain) {
    return { text: ciphertextOrPlain || '', isEncrypted: false };
  }

  if (ciphertextOrPlain.startsWith(SIGNAL_PREFIX)) {
    try {
      const { decryptIfSignal } = await import('./signalMessageAdapter');
      const res = await decryptIfSignal(ciphertextOrPlain, senderId || '');
      return res;
    } catch (e) {
      return { text: '[Signal decrypt failed]', isEncrypted: true };
    }
  }

  if (!ciphertextOrPlain.startsWith(E2EE_PREFIX)) {
    return { text: ciphertextOrPlain || '', isEncrypted: false };
  }

  try {
    if (!window.crypto?.subtle) {
      return { text: '[Encrypted message — Web Crypto unsupported]', isEncrypted: true };
    }

    const base64Payload = ciphertextOrPlain.slice(E2EE_PREFIX.length);
    const jsonStr = window.atob(base64Payload);
    const payload = JSON.parse(jsonStr);

    const iv = new Uint8Array(base64ToArrayBuffer(payload.iv));
    const ct = base64ToArrayBuffer(payload.ct);
    const key = await getConversationKey(conversationId);

    const decrypted = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      ct
    );

    const dec = new TextDecoder();
    return { text: dec.decode(decrypted), isEncrypted: true };
  } catch (err) {
    console.warn('[E2EE] Decryption error:', err);
    return { text: '[Decryption failed — key mismatch]', isEncrypted: true };
  }
}
