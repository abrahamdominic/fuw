import {
  KeyHelper,
  SignalProtocolAddress,
  SessionBuilder,
  SessionCipher,
} from '@privacyresearch/libsignal-protocol-typescript';
import { requireSupabase } from './supabase';

const DEVICE_ID_KEY = 'fuw_signal_device_id';
const STORE_KEY_PREFIX = 'fuw_signal_store_';

function arrayBufferToBase64(buf: any): string {
  if (!buf) return '';
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

class LocalSignalStore {
  private userId: string;
  constructor(userId: string) {
    this.userId = userId;
  }
  private k(path: string) {
    return `${STORE_KEY_PREFIX}${this.userId}:${path}`;
  }
  getItem(k: string): any {
    try {
      const v = localStorage.getItem(this.k(k));
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  }
  setItem(k: string, v: any) {
    try {
      localStorage.setItem(this.k(k), JSON.stringify(v));
    } catch {}
  }

  async getIdentityKeyPair(): Promise<any> {
    const v = this.getItem('identityKey');
    if (!v) return undefined;
    return {
      pubKey: base64ToArrayBuffer(v.pubKey),
      privKey: base64ToArrayBuffer(v.privKey),
    };
  }

  async putIdentityKeyPair(kp: any) {
    this.setItem('identityKey', {
      pubKey: arrayBufferToBase64(kp.pubKey),
      privKey: arrayBufferToBase64(kp.privKey),
    });
  }

  async getLocalRegistrationId(): Promise<number> {
    return this.getItem('registrationId') || 0;
  }

  async putLocalRegistrationId(id: number) {
    this.setItem('registrationId', id);
  }

  async isTrustedIdentity(): Promise<boolean> {
    return true;
  }

  async loadPreKey(keyId: number): Promise<any> {
    const keys = this.getItem('preKeys') || {};
    const k = keys[keyId];
    if (!k) return undefined;
    return {
      pubKey: base64ToArrayBuffer(k.pubKey),
      privKey: base64ToArrayBuffer(k.privKey),
    };
  }

  async storePreKey(keyId: number, keyPair: any) {
    const keys = this.getItem('preKeys') || {};
    keys[keyId] = {
      pubKey: arrayBufferToBase64(keyPair.pubKey),
      privKey: arrayBufferToBase64(keyPair.privKey),
    };
    this.setItem('preKeys', keys);
  }

  async removePreKey(keyId: number) {
    const keys = this.getItem('preKeys') || {};
    delete keys[keyId];
    this.setItem('preKeys', keys);
  }

  async loadSignedPreKey(): Promise<any> {
    const v = this.getItem('signedPreKey');
    if (!v) return undefined;
    return {
      keyId: v.keyId,
      keyPair: {
        pubKey: base64ToArrayBuffer(v.pubKey),
        privKey: base64ToArrayBuffer(v.privKey),
      },
    };
  }

  async storeSignedPreKey(keyId: number, keyPair: any) {
    this.setItem('signedPreKey', {
      keyId,
      pubKey: arrayBufferToBase64(keyPair.pubKey),
      privKey: arrayBufferToBase64(keyPair.privKey),
    });
  }

  async removeSignedPreKey() {}

  async loadSession(identifier: string): Promise<any> {
    return this.getItem(`session:${identifier}`);
  }

  async storeSession(identifier: string, record: any) {
    this.setItem(`session:${identifier}`, record);
  }
}

export class SignalE2EE {
  async ensureDevice(): Promise<{ deviceId: number }> {
    const client = requireSupabase();
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) {
      return { deviceId: parseInt(existing) };
    }

    const store = new LocalSignalStore(user.id);
    let identity = await store.getIdentityKeyPair();
    if (!identity) {
      identity = await KeyHelper.generateIdentityKeyPair();
      await store.putIdentityKeyPair(identity);
    }

    let regId = await store.getLocalRegistrationId();
    if (!regId) {
      regId = await KeyHelper.generateRegistrationId();
      await store.putLocalRegistrationId(regId);
    }

    const signedPreKey = await KeyHelper.generateSignedPreKey(identity, 1);
    await store.storeSignedPreKey(signedPreKey.keyId, signedPreKey.keyPair);

    const preKeys = [];
    for (let i = 2; i <= 11; i++) {
      const pk = await KeyHelper.generatePreKey(i);
      await store.storePreKey(pk.keyId, pk.keyPair);
      preKeys.push(pk);
    }

    const deviceId = Math.floor(Math.random() * 10000000);
    localStorage.setItem(DEVICE_ID_KEY, deviceId.toString());

    await client.from('user_devices').upsert({
      user_id: user.id,
      device_id: deviceId,
      identity_pub: arrayBufferToBase64(identity.pubKey),
      registration_id: regId,
      signed_prekey_pub: arrayBufferToBase64(signedPreKey.keyPair.pubKey),
      signed_prekey_sig: arrayBufferToBase64(signedPreKey.signature),
    }, { onConflict: 'user_id,device_id' }).select();

    const { data: devRow } = await client.from('user_devices').select('id').eq('user_id', user.id).eq('device_id', deviceId).single();
    const prekeyRows = preKeys.map(pk => ({
      device_id: devRow?.id,
      key_id: pk.keyId,
      public_key: arrayBufferToBase64(pk.keyPair.pubKey),
    })).filter(r => r.device_id);

    if (prekeyRows.length > 0) {
      await client.from('prekeys').insert(prekeyRows);
    }

    return { deviceId };
  }

  async buildSessionWithPeer(peerId: string): Promise<void> {
    const client = requireSupabase();
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    await this.ensureDevice();
    const store = new LocalSignalStore(user.id);

    const { data: peerDevices } = await client.rpc('get_peer_devices', { p_user_id: peerId });
    if (!peerDevices || peerDevices.length === 0) return;

    for (const pd of peerDevices) {
      const address = new SignalProtocolAddress(peerId, pd.device_id);
      const sessionBuilder = new SessionBuilder(store as any, address);

      const prekeyBundle = await client.rpc('get_prekey_bundle', { p_user_id: peerId, p_device_id: pd.device_id });
      const bundle: any = {
        registrationId: pd.registration_id,
        identityKey: base64ToArrayBuffer(pd.identity_pub),
        signedPreKey: {
          keyId: 1,
          publicKey: base64ToArrayBuffer(pd.signed_prekey_pub),
          signature: base64ToArrayBuffer(pd.signed_prekey_sig),
        },
      };
      if (prekeyBundle && prekeyBundle.data?.preKey) {
        bundle.preKey = {
          keyId: prekeyBundle.data.preKey.keyId,
          publicKey: base64ToArrayBuffer(prekeyBundle.data.preKey.publicKey),
        };
      }

      try {
        await (sessionBuilder as any).processPreKey(bundle);
      } catch (e) {
        console.warn('Session build failed', e);
      }
    }
  }

  async encryptToPeer(peerId: string, plaintext: string): Promise<{ type: string; body: string; fromDeviceId: number }> {
    const client = requireSupabase();
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    await this.ensureDevice();
    const store = new LocalSignalStore(user.id);
    const deviceId = parseInt(localStorage.getItem(DEVICE_ID_KEY) || '1');

    await this.buildSessionWithPeer(peerId);

    const { data: peerDevices } = await client.rpc('get_peer_devices', { p_user_id: peerId });
    if (!peerDevices || peerDevices.length === 0) throw new Error('No peer devices');

    const pd = peerDevices[0];
    const address = new SignalProtocolAddress(peerId, pd.device_id);
    const cipher = new SessionCipher(store as any, address);
    const result: any = await cipher.encrypt(new TextEncoder().encode(plaintext));

    return {
      type: result.type === 3 ? 'PreKeySignalMessage' : 'SignalMessage',
      body: arrayBufferToBase64(result.body),
      fromDeviceId: deviceId,
    };
  }

  async decryptFromPeer(senderId: string, fromDeviceId: number, body: string, type: string): Promise<string> {
    const client = requireSupabase();
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    await this.ensureDevice();
    const store = new LocalSignalStore(user.id);

    const address = new SignalProtocolAddress(senderId, fromDeviceId);
    const cipher = new SessionCipher(store as any, address);
    const ct = base64ToArrayBuffer(body);

    try {
      if (type === 'PreKeySignalMessage') {
        const res = await (cipher as any).decryptPreKeyWhisperMessage(ct, 'binary');
        return new TextDecoder().decode(res);
      } else {
        const res = await (cipher as any).decryptWhisperMessage(ct, 'binary');
        return new TextDecoder().decode(res);
      }
    } catch (e) {
      console.warn('Decrypt failed', e);
      throw e;
    }
  }
}

export const signalE2EE = new SignalE2EE();
