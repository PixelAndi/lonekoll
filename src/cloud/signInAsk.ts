import { useEffect, useState } from 'react';

// When the app needs something from the user's Google Drive and isn't signed
// in, it asks first – saying why – and Google's window opens only from the
// tap on "Logga in med Google" in that question (browsers allow it only
// right after a tap). Sync of what is saved on the phone never asks: it waits,
// shown by the cloud in the header.

export type SignInReason = 'original' | 'fetchAll';

interface Ask {
  reason: SignInReason;
  /** Signs in from the tap; resolves the asker's wait. */
  signIn: () => Promise<void>;
  cancel: () => void;
}

let current: Ask | null = null;
const listeners = new Set<(a: Ask | null) => void>();
const set = (a: Ask | null) => {
  current = a;
  listeners.forEach((l) => l(a));
};

/** Asks the user to sign in for this reason; resolves once signed in, rejects if they decline. */
export function askToSignIn(reason: SignInReason, signIn: () => Promise<void>): Promise<void> {
  current?.cancel();
  return new Promise((resolve, reject) => {
    set({
      reason,
      signIn: async () => {
        try {
          await signIn();
          set(null);
          resolve();
        } catch (e) {
          set(null);
          reject(e);
        }
      },
      cancel: () => {
        set(null);
        reject(new Error('cancelled'));
      },
    });
  });
}

export function useSignInAsk(): Ask | null {
  const [ask, setAsk] = useState(current);
  useEffect(() => {
    listeners.add(setAsk);
    return () => void listeners.delete(setAsk);
  }, []);
  return ask;
}
