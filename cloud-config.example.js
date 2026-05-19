// Local Outline — cloud sync configuration template.
// Copy this file to `cloud-config.js` and fill in the public web config from
// your Firebase project (Project settings → Your apps → Web app → SDK setup).
// The real `cloud-config.js` is gitignored.
//
// If `cloud-config.js` is absent, the cloud-sync UI silently disables itself
// and the app continues to work fully offline.

window.LOCAL_OUTLINE_CLOUD = {
  firebase: {
    apiKey:            'YOUR_API_KEY',
    authDomain:        'your-project.firebaseapp.com',
    projectId:         'your-project',
    storageBucket:     'your-project.appspot.com',
    messagingSenderId: 'YOUR_SENDER_ID',
    appId:             'YOUR_APP_ID',
  },
}
