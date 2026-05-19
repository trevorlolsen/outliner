// Local Outline — cloud sync configuration.
//
// These are PUBLIC Firebase web SDK identifiers (Firebase docs intentionally
// embed them in client code). Security comes from the Firestore rules and
// Firebase Auth, NOT from hiding these values:
//   - firestore.rules pins access to a single verified email
//   - Firebase Auth gates who can sign in (Google OAuth)
//   - The "apiKey" is a browser API key — it identifies the project, not a secret
//
// To regenerate from a different project: copy cloud-config.example.js.

window.LOCAL_OUTLINE_CLOUD = {
  firebase: {
    apiKey:            "AIzaSyA5TUr6Alawwyn2g0gvSAFFrvsghS_i2vA",
    authDomain:        "local-outline-personal.firebaseapp.com",
    projectId:         "local-outline-personal",
    storageBucket:     "local-outline-personal.firebasestorage.app",
    messagingSenderId: "1075898801126",
    appId:             "1:1075898801126:web:996541d91f608d0b859427",
  },
}
