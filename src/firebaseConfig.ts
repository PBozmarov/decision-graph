// Firebase web config for pomoplan.tech.
// These values are public by design (they identify the project, they don't grant access);
// privacy is enforced by the Firestore security rules, which only let a signed-in user
// read and write their own documents under users/{uid}/.
// Leave apiKey empty to run without accounts (local-only mode).
export const firebaseConfig = {
  apiKey: 'AIzaSyC2sI8pDDMs9VCnrAr78zNC16agzKKlAXg',
  authDomain: 'pomoplan-tech-25101.firebaseapp.com',
  projectId: 'pomoplan-tech-25101',
  storageBucket: 'pomoplan-tech-25101.firebasestorage.app',
  messagingSenderId: '734725173894',
  appId: '1:734725173894:web:35e153015ab3c2de64d707',
};
