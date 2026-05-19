# Blueprint: Local-Only Encrypted Markdown Outliner

Technical design for a serverless Dynalist-style alternative using IndexedDB, snapshots, Markdown import/export, code blocks, and encrypted image storage

Date: May 11, 2026  
Prepared for: Trevor Olsen

## Executive summary

The application is a serverless, single-user, local-only Markdown-oriented outliner inspired by Dynalist-style workflows. It runs as a static web application, stores all user content in IndexedDB, encrypts content before persistence, and supports portable encrypted snapshot files for moving data between devices.

## Product scope

### Goals

- Fast local outliner for hierarchical notes, tasks, project planning, and knowledge management.
- IndexedDB persistence with encrypted content.
- Markdown import/export as the canonical text interchange format.
- Syntax-highlighted code blocks with language tags.
- Image blocks stored encrypted in IndexedDB and included in encrypted snapshots.
- Encrypted snapshots for backup and device transfer.

### Non-goals

- No backend.
- No accounts.
- No cloud sync.
- No multi-user collaboration.
- No public sharing links.
- No server-side password recovery.

## Architecture

```text
Browser static app
  UI layer
  Domain layer
  Security layer
  Persistence layer
  Portability layer
```

Recommended stack:

- Vite + TypeScript
- Dexie for IndexedDB
- Plain TypeScript or Svelte for UI
- CodeMirror 6 for code block editing
- Prism, highlight.js, or Shiki for syntax highlighting
- markdown-it or micromark for Markdown import/export
- Web Crypto AES-GCM, PBKDF2 fallback, Argon2id via WASM preferred

## Key hierarchy

```text
User password
  -> KDF(password, salt)
  -> password-derived key

Random 256-bit vault key
  -> encrypts/decrypts content records and image assets

password-derived key
  -> encrypts/decrypts the vault key only
```

## IndexedDB schema

```ts
db.version(1).stores({
  vaultMeta: "id",
  keyRecords: "id",
  encryptedRecords: "id, store, updatedAt",
  encryptedAssets: "id, kind, updatedAt",
  appState: "key"
});
```

## Snapshot format

Encrypted snapshots expose only metadata and ciphertext:

```json
{
  "app": "local-outline",
  "snapshotVersion": 1,
  "encrypted": true,
  "createdAt": 1778520000000,
  "encryption": {
    "algorithm": "AES-GCM",
    "kdf": "argon2id",
    "salt": "base64...",
    "iv": "base64...",
    "keyVersion": 1
  },
  "ciphertext": "base64..."
}
```

## MVP acceptance test

```text
Create a document
Add nested bullets
Indent/outdent/move items
Add checkboxes
Collapse sections
Zoom into a node
Add a fenced TypeScript code block
Paste an image
Export encrypted snapshot
Delete browser data
Reload app
Import encrypted snapshot
Everything returns exactly as before
Export document as Markdown
Import that Markdown into a clean database
Structure is preserved
```

For the full build plan, data model, roadmap, tests, and implementation checklist, use the DOCX blueprint.

See `outliner_technical_blueprint.md` for the full implementation reference that documents the current code (25 sections, with file:line anchors into `index.html`).
