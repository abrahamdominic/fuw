import {
  KeyHelper,
  SignalProtocolAddress,
  SessionBuilder,
  SessionCipher,
} from '@privacyresearch/libsignal-protocol-typescript';
import { requireSupabase } from './supabase';

export interface SignalDevice {
  userId: string;
  deviceId: number;
  identityKeyPair: any;
  registrationId: number;
  signedPreKey: any;
  preKeys: any[];
}

class SignalStore {
  private store: Map<string, any> = new Map();

  async get(key: string, defaultValue?: any): Promise<any> {
    if (this.store.has(key)) return this.store.get(key);
    return defaultValue;
  }

  async put(key: string, value: any): Promise<void> {
    this.store.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }

  async getIdentityKeyPair(): Promise<any> {
    return this.store.get('identityKey');
  }

  async getLocalRegistrationId(): Promise<number> {
    return this.store.get('registrationId');
  }

  async isTrustedIdentity(identifier: string, identityKey: any): Promise<boolean> {
    return true;
  }

  async loadIdentityKey(identifier: string): Promise<any> {
    return undefined;
  }

  async saveIdentity(identifier: string, identityKey: any): Promise<boolean> {
    return true;
  }

  async loadPreKey(keyId: number): Promise<any> {
    const keys = this.store.get('preKeys') || {};
    return keys[keyId] || undefined;
  }

  async storePreKey(keyId: number, keyPair: any): Promise<void> {
    const keys = this.store.get('preKeys') || {};
    keys[keyId] = keyPair;
    this.store.set('preKeys', keys);
  }

  async removePreKey(keyId: number): Promise<void> {
    const keys = this.store.get('preKeys') || {};
    delete keys[keyId];
    this.store.set('preKeys', keys);
  }

  async loadSession(identifier: string): Promise<any> {
    return this.store.get(`session:${identifier}`);
  }

  async storeSession(identifier: string, record: any): Promise<void> {
    this.store.set(`session:${identifier}`, record);
  }

  async loadSignedPreKey(keyId: number): Promise<any> {
    return this.store.get(`signedPreKey:${keyId}`);
  }

  async storeSignedPreKey(keyId: number, keyPair: any): Promise<void> {
    this.store.set(`signedPreKey:${keyId}`, keyPair);
  }

  async removeSignedPreKey(keyId: number): Promise<void> {
    this.store.delete(`signedPreKey:${keyId}`);
  }
}

export class SignalClient {
  private store = new SignalStore();
  private device: SignalDevice | null = null;

  async initialize(): Promise<SignalDevice> {
    if (this.device) return this.device;

    const client = requireSupabase();
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
    const registrationId = await KeyHelper.generateRegistrationId();
    const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);
    const preKeys = [];
    for (let i = 1; i <= 10; i++) {
      preKeys.push(await KeyHelper.generatePreKey(i));
    }

    await this.store.put('identityKey', identityKeyPair);
    await this.store.put('registrationId', registrationId);
    await this.store.put(`signedPreKey:1`, signedPreKey);
    await this.store.put('preKeys', {});

    for (let i = 0; i < preKeys.length; i++) {
      await this.store.storePreKey(preKeys[i].keyId, preKeys[i].keyPair);
    }

    const deviceId = Math.floor(Math.random() * 1000000);
    this.device = {
      userId: user.id,
      deviceId,
      identityKeyPair,
      registrationId,
      signedPreKey,
      preKeys,
    };

    return this.device;
  }
}
