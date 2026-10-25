import { useEffect, useState } from 'react';
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import { OWNER_UID, firebaseConfig } from './firebaseConfig';
import type { Item } from './model';

export const cloudEnabled = !!firebaseConfig.apiKey;

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

function init() {
  if (!cloudEnabled) throw new Error('Cloud sync is not configured');
  if (!app) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = initializeFirestore(app, {
      // Optional item fields (done, rationale, …) may be undefined; Firestore rejects those otherwise.
      ignoreUndefinedProperties: true,
      // Keep a local copy so the app works offline and loads instantly; writes sync when back online.
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  }
  return { auth: auth!, db: db! };
}

/* ---------- auth ---------- */

export type Account = { uid: string; name: string; email: string; photo: string | null };

const toAccount = (u: User): Account => ({
  uid: u.uid,
  name: u.displayName || u.email || 'Signed in',
  email: u.email || '',
  photo: u.photoURL,
});

/** Current account; `loading` is true until Firebase has restored a previous session. */
export function useAuth() {
  const [state, setState] = useState<{ account: Account | null; loading: boolean }>({
    account: null,
    loading: cloudEnabled,
  });
  useEffect(() => {
    if (!cloudEnabled) return;
    return onAuthStateChanged(init().auth, (u) => {
      if (u && u.uid !== OWNER_UID) {
        // Not the owner: don't keep them signed in.
        void signOut(init().auth);
        setState({ account: null, loading: false });
        return;
      }
      setState({ account: u ? toAccount(u) : null, loading: false });
    });
  }, []);
  return state;
}

/** Thrown when someone other than the owner signs in. */
export class NotAllowedError extends Error {}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const { user } = await signInWithPopup(init().auth, provider);
  if (user.uid !== OWNER_UID) {
    await signOut(init().auth);
    throw new NotAllowedError('This app is private');
  }
}

export const signOutUser = () => signOut(init().auth);

/* ---------- decisions ---------- */

export type CloudDoc = { id: string; items: Item[]; createdAt: number; updatedAt: number };
export type CloudChange = { type: 'upsert'; doc: CloudDoc } | { type: 'remove'; id: string };

/** Live updates for the signed-in user's decisions. Local echoes of our own writes are skipped. */
export function watchDocs(
  uid: string,
  onChanges: (changes: CloudChange[], first: boolean) => void,
  onError: (e: Error) => void,
) {
  let first = true;
  return onSnapshot(
    collection(init().db, 'users', uid, 'docs'),
    (snap) => {
      const changes: CloudChange[] = [];
      for (const c of snap.docChanges()) {
        if (c.doc.metadata.hasPendingWrites) continue;
        if (c.type === 'removed') changes.push({ type: 'remove', id: c.doc.id });
        else {
          const d = c.doc.data() as Omit<CloudDoc, 'id'>;
          changes.push({ type: 'upsert', doc: { id: c.doc.id, items: d.items ?? [], createdAt: d.createdAt ?? 0, updatedAt: d.updatedAt ?? 0 } });
        }
      }
      onChanges(changes, first);
      first = false;
    },
    onError,
  );
}

export const saveCloudDoc = (uid: string, d: CloudDoc) =>
  setDoc(doc(init().db, 'users', uid, 'docs', d.id), { items: d.items, createdAt: d.createdAt, updatedAt: d.updatedAt });

export const removeCloudDoc = (uid: string, id: string) => deleteDoc(doc(init().db, 'users', uid, 'docs', id));
