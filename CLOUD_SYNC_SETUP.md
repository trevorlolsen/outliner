# Cloud Sync Setup

Local Outline can sync vaults across devices through Firebase. Setup is a
one-time process; afterwards the **Cloud sync** panel in the sidebar lets you
push, pull, and reconcile vaults git-style.

The cloud sees only encrypted ciphertext — your vault password never leaves
your devices, and Google sign-in is only used to identify *whose* encrypted
blobs belong to whom.

Everything (docs, nodes, images) lives in **Firestore only**. There is no
Firebase Storage requirement, so the free **Spark plan** is enough and no
billing account is required.

## 1. Create a Firebase project (free Spark plan)

1. Go to https://console.firebase.google.com → **Add project**.
2. Name it anything (e.g. `local-outline-personal`).
3. Skip Google Analytics — not needed.
4. After creation, click **</>** (Web) to register a web app. Give it a
   nickname; do **not** enable Firebase Hosting.
5. Copy the printed `firebaseConfig` object — those values go into the
   `cloud-config.js` file below.

## 2. Enable the two services you need

In the Firebase console for your project:

- **Authentication** → Get started → **Sign-in method** → enable **Google**.
- **Firestore Database** → Create database → **Production mode** → pick a
  region close to you.

> Skip Storage. Image attachments are chunked into Firestore docs (~900 KB
> each), so we never need a separate Storage bucket. This is what keeps the
> setup on the free tier.

## 3. Deploy the Firestore security rules

The repo ships with `firestore.rules` that locks every record to the user
that owns it. Two options:

**A. Paste in the console** (no CLI). Open `firestore.rules` from this repo,
copy its contents, paste into Firestore → **Rules** in the console, click
**Publish**.

**B. Use the Firebase CLI** (one-time install, easier for updates):

```sh
npm install -g firebase-tools
firebase login
firebase init firestore   # accept defaults; point at firestore.rules
firebase deploy --only firestore:rules
```

## 4. Add your config to the app

```sh
cp cloud-config.example.js cloud-config.js
```

Open `cloud-config.js` and paste the values from step 1. The file is
gitignored, so your config never lands in git.

If `cloud-config.js` is absent, the cloud-sync UI silently disables — Local
Outline keeps working as a pure offline app.

## 5. Authorize your domain (if hosting somewhere other than localhost)

Firebase Auth → Settings → **Authorized domains** → add the domain you serve
the app from. `localhost` is allowed by default.

## 6. Use it

Reload the app. A **Cloud sync** button appears in the sidebar.

- **Sign in** with Google.
- For each vault, click **Link to cloud** → the first push uploads the
  encrypted vault.
- On another device, sign in with the same Google account, choose
  **Pull from cloud**, pick the vault, and enter its password to unlock.
- Routine sync is **Push** / **Pull** buttons in the cloud panel. Edits made
  on both sides since the last sync are duplicated rather than overwritten:
  - Documents → a sibling document named `<title> (cloud conflict)` is
    created with the cloud-side tree of nodes.
  - Nodes → a sibling node tagged `[conflict]` appears next to the local
    node, holding the cloud-side body.

## Free-tier limits

The Spark plan is free forever and covers a single user comfortably:

| Service         | Limit                                          |
| --------------- | ---------------------------------------------- |
| Firestore       | 1 GiB storage, 50K reads / 20K writes per day |
| Authentication  | 50K monthly active users                       |

Image attachments are chunked: a 5 MB image becomes ~6 small Firestore docs
on push. That's still well within the 20K daily write budget — you'd need to
push hundreds of large images per day to feel it. The hard cap per image is
~15 MB (anything larger is skipped with a clear warning).
