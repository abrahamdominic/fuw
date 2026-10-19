import { signalE2EE } from './signalE2EE';
import { requireSupabase } from './supabase';

const SIGNAL_MSG_PREFIX = 'sig:v1:';

export interface SignalEnvelope {
  type: 'PreKeySignalMessage' | 'SignalMessage';
  body: string;
  fromDeviceId: number;
  toDeviceId?: number;
}

function encodeEnvelope(env: SignalEnvelope): string {
  return SIGNAL_MSG_PREFIX + btoa(JSON.stringify(env));
}

function decodeEnvelope(blob: string): SignalEnvelope | null {
  if (!blob.startsWith(SIGNAL_MSG_PREFIX)) return null;
  try {
    const json = atob(blob.slice(SIGNAL_MSG_PREFIX.length));
    const parsed = JSON.parse(json);
    return {
      type: parsed.type === 'PreKeySignalMessage' ? 'PreKeySignalMessage' : 'SignalMessage',
      body: parsed.body,
      fromDeviceId: parsed.fromDeviceId,
    };
  } catch {
    return null;
  }
}

export async function encryptForPeer(peerId: string, plaintext: string): Promise<string> {
  const env = await signalE2EE.encryptToPeer(peerId, plaintext);
  return encodeEnvelope({
    type: env.type === 'PreKeySignalMessage' ? 'PreKeySignalMessage' : 'SignalMessage',
    body: env.body,
    fromDeviceId: env.fromDeviceId,
  });
}

export async function decryptIfSignal(blob: string, senderId: string): Promise<{ text: string; isEncrypted: boolean }> {
  const env = decodeEnvelope(blob);
  if (!env) {
    return { text: blob, isEncrypted: false };
  }
  try {
    const text = await signalE2EE.decryptFromPeer(senderId, env.fromDeviceId, env.body, env.type);
    return { text, isEncrypted: true };
  } catch (e) {
    return { text: '[Signal decrypt failed]', isEncrypted: true };
  }
}
