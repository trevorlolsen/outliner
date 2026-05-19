# Technical Blueprint: Local-Only Encrypted Markdown Outliner

> See also: `local_outliner_blueprint.md` for the short executive summary. This document is the full implementation reference and describes the code as it actually exists in `index.html`.

## 1. Product Summary

Local Outline is a serverless, single-user, local-first hierarchical outliner that runs entirely in the browser. It is delivered as a static web app (`index.html` plus a pre-bundled dependency file at `libs/deps.js`) and persists all content in IndexedDB. Every node body, image blob, and document title is encrypted with AES-GCM before it touches the database; the encryption key is derived from a user-supplied password using Argon2id (with a PBKDF2 fallback for environments where the Argon2id WASM cannot be loaded).

The application supports multiple independent vaults on one device, each unlocked by its own password and with its own encryption key. Inside a vault, the user works on a tree of documents and within each document a tree of typed nodes: plain text, checkbox, code block (edited with CodeMirror 6), and image. Nodes are ordered with fractional indices so that indent, outdent, and move operations touch only a single key.

Portability is provided by an encrypted snapshot file (`.json`) which can be exported from one device and imported into a fresh vault on another. There is no server, no account, no cloud sync, and no password recovery path: the snapshot file is the only durable copy of data the user holds outside the browser profile.

The four headline capabilities are:

1. Encrypted hierarchical outline tree with indent / outdent / move / collapse / zoom / undo.
2. End-to-end encryption with Argon2id KDF, AES-GCM-256 content encryption, and a wrapped vault key.
3. Per-node syntax-highlighted code blocks (CodeMirror 6) across 12 language modes.
4. Encrypted image blocks (paste from clipboard) and three export formats: encrypted snapshot, Markdown, and self-contained HTML.

## 2. Goals and Non-Goals

### 2.1 Goals

- Fast local outliner for hierarchical notes, tasks, project planning, and knowledge management.
- IndexedDB persistence with all content encrypted at rest.
- Multi-vault support so a single device can hold logically separate stores (e.g. Personal / Work) with independent passwords.
- Markdown import/export as the canonical text interchange format.
- Self-contained HTML export with inline images and pre-rendered math.
- Syntax-highlighted code blocks with language tags (CodeMirror 6).
- Image blocks stored encrypted in IndexedDB and included in encrypted snapshots.
- Encrypted snapshots for backup and device transfer.
- Full-text search across decrypted nodes (in-memory index, built on unlock).
- Optional spaced-repetition study mode for nodes promoted to flashcards.
- Daily notes with a calendar picker.
- Tag extraction and tag-filtered views.
- Auto-snapshot to a user-chosen filesystem directory via the File System Access API.
- Offline-first PWA with installable manifest and service worker precache.

### 2.2 Non-Goals

- No backend.
- No accounts.
- No cloud sync.
- No multi-user collaboration.
- No public sharing links.
- No server-side password recovery.
- No telemetry.

## 3. Technology Stack

### 3.1 Runtime

- Static HTML page (`index.html`, ~5,700 lines) served from any web host or `file://`.
- One ES module `<script type="module">` block; all application code lives inline.
- Single pre-bundled dependency file at `libs/deps.js` produced by esbuild.
- Service worker `sw.js` registered on first load for offline operation.
- PWA `manifest.webmanifest` for installability (standalone display, dark theme `#141414`).

### 3.2 Runtime Dependencies

Imported from `libs/deps.js` ([index.html:686-691](index.html#L686-L691)):

| Dependency | Source | Purpose |
|---|---|---|
| `Dexie` | `dexie@4` | IndexedDB wrapper, schema versioning, and migrations |
| `MarkdownIt` | `markdown-it@14` | Inline Markdown rendering of node text |
| `argon2id` | `hash-wasm@4` | Password-based key derivation (preferred) |
| `generateKeyBetween` | `fractional-indexing@1` | Fractional sibling ordering |
| `basicSetup`, `EditorView` | `codemirror@6` | Code-block editor scaffolding |
| `oneDark` | `@codemirror/theme-one-dark` | Code-block theme |
| `javascript`, `python`, `markdownLang`, `css`, `html`, `json`, `sql`, `rust`, `cpp`, `java` | `@codemirror/lang-*` | Language modes |
| `StreamLanguage`, `julia`, `r` | `@codemirror/language`, `@codemirror/legacy-modes` | Legacy-mode wrappers for Julia and R |

CDN-loaded (precached by the service worker on first hit):

- KaTeX CSS and JS (`cdn.jsdelivr.net/npm/katex@0.16.11`) for math rendering. Loaded with `<link>`/`<script async>` from `index.html` head ([index.html:9-10](index.html#L9-L10)).

### 3.3 Build Tooling

The only build step is bundling dependencies:

```bash
npm run bundle-deps
# expands to:
esbuild deps-entry.mjs --bundle --format=esm --outfile=libs/deps.js \
                       --platform=browser --minify
```

`deps-entry.mjs` is a thin re-export hub that lists every symbol the app imports. The resulting `libs/deps.js` is committed and served directly. There is no transpilation, bundler, or framework for application code itself — `index.html` is shipped as-authored.

### 3.4 Browser APIs

Required:

- **IndexedDB** for all persistence.
- **Web Crypto** (`crypto.subtle`) for AES-GCM, PBKDF2, key wrap/unwrap, random IV/salt generation.
- **File input / Blob / `URL.createObjectURL`** for snapshot, Markdown, HTML, and image I/O.
- **Service Worker** for offline shell caching.
- **Clipboard `paste` events** for image insertion.

Optional, used when available:

- **File System Access API** (`showDirectoryPicker`) for the auto-snapshot feature.
- **Web Share API** is not used; downloads go through anchor `download` clicks.

## 4. Application Architecture

### 4.1 Single-File Monolithic SPA

Unlike the sibling flash app, which is split across `src/db/`, `src/cards/`, `src/review/`, etc., Local Outline is a single-file SPA. All application code lives inside one `<script type="module">` block in `index.html`. The trade-off is deliberate: distribution is a static file pair (HTML + `libs/deps.js`), and grep-by-line replaces module navigation. The cost is that the file is long and section ordering inside it matters.

The file is organised top-to-bottom by layer. Reading it linearly reveals roughly:

```text
index.html
  CSS variables and styles               (lines  11 – 495)
  HTML scaffolding (modals + main app)   (lines 497 – 683)
  <script type="module">
    Imports from ./libs/deps.js          (lines 686 – 691)
    Utilities (b64, ids, time, defaults) (lines 693 – 720)
    Database (Dexie schema v1, v2)       (lines 722 – 750)
    Crypto (KDF + AES-GCM + vault flow)  (lines 752 – 936)
    Records CRUD                         (lines 938 – ...)
    Snapshot import/export, Markdown,    (lines 1365 – 1700)
      HTML export, flash card import
    Search index                         (lines 1811 – 1970)
    Node model + tree ops + rendering    (lines 2098 – 3200)
    Undo/redo + shortcuts                (lines 3290 – 3370)
    UI controllers, modals, study mode   (lines 3500 – 5500)
    Service-worker registration          (line  5598)
  </script>
```

### 4.2 Layered Responsibilities

Five logical layers, even though they are not physically separated:

```text
UI layer          DOM templates, contenteditable nodes, modals, CodeMirror instances
Domain layer      Node tree, document model, operations, undo stack, search index
Security layer    KDF, AES-GCM encrypt/decrypt, vault key wrap/unwrap, auto-lock
Persistence layer Dexie tables (vaultMeta, keyRecords, encryptedRecords, encryptedAssets, appState)
Portability layer Snapshot encrypt/decrypt, Markdown serialise/parse, HTML export, flash card import
```

### 4.3 Architectural Invariant

Plaintext **never** crosses the persistence boundary in either direction. `encPayload` and `decPayload` are the only call sites that hand bytes to `ctx.encrypt` / `ctx.decrypt`, and `ctx` is the only carrier of the unwrapped vault key. The vault key lives only in memory; the wrapped form on disk is useless without the password.

## 5. Core Screens

All screens are sibling DOM nodes in `index.html` ([index.html:497-683](index.html#L497-L683)) that are shown or hidden by toggling the `hidden` class.

### 5.1 Vault Picker (`#vault-screen`)

Shown on initial load when no vault is currently unlocked. Lists every vault stored in `vaultMeta` and offers three actions: open an existing vault (which opens the unlock modal), create a new vault (`+ New vault`), or import a vault from an encrypted snapshot file.

### 5.2 Create Vault Modal (`#vault-new-modal`)

Collects vault name, password, and confirmation. Requires the password to be at least 8 characters and the confirmation to match. Shows an inline KDF warning if Argon2id is unavailable: "Argon2id unavailable (offline?). This vault will use PBKDF2 — still secure, but weaker against offline cracking. It will silently upgrade on the next online unlock." ([index.html:522](index.html#L522)).

### 5.3 Unlock Vault Modal (`#vault-unlock-modal`)

Single password input. On submit calls `unlockVault(vaultId, password)`. Surfaces "Wrong password" on failure. Triggers the silent PBKDF2 → Argon2id migration if applicable (see §7.5).

### 5.4 Main App Shell (`#app`)

Two columns:

- **Sidebar (`#sidebar`)**: vault label, back-to-vaults button, search button, "+ New" doc button, sidebar-toggle. Below that: a "Today" daily-note button with a month calendar grid, the document list, a tag panel with clear-filter, the auto-snapshot enable button, and a bottom row with Import / Export / Theme / Change-password buttons.
- **Editor area (`#editor-area`)**: doc title input + breadcrumb, the outline tree (`#outline-tree`), an add-bar with `+ Text` and `+ Code` buttons, and a status bar showing node and word counts. When no document is selected the placeholder `Select or create a document.` is shown.

### 5.5 Export Modal (`#export-modal`)

Four tabs:

1. **Encrypted snapshot** — requires re-entering the vault password, exports all documents and assets.
2. **Markdown** — exports the active document only; images are not included.
3. **HTML** — exports the active document as a self-contained HTML file with inline CSS, rendered Markdown, and rendered math.
4. **Print / PDF** — opens the browser print dialog; the print stylesheet (see §22) hides chrome.

### 5.6 Import Modal (`#import-modal`)

Markdown-only file picker that creates a new document in the current vault. Snapshot import lives on the vault picker screen instead, because it creates a new vault.

### 5.7 Change Password Modal (`#vault-chpass-modal`)

Current password, new password, confirm. Calls `changeVaultPassword`, which re-derives the password key with a fresh KDF spec and re-wraps the existing vault key. The vault key itself does not change, so no record content is re-encrypted.

### 5.8 Study Overlay (`#study-overlay`)

Spaced-repetition review surface for nodes promoted to flashcards (see §14). Shows the prompt, a flip control to reveal the answer, and grade buttons. Hidden by the print stylesheet.

### 5.9 Search Overlay (`#search-overlay`)

Triggered by `Ctrl+Shift+F` or the sidebar search button. Query input plus a results list grouped by document.

### 5.10 Context Menu, Help, Palette, Autocomplete

Smaller overlays (all hidden when printing): `#node-ctx-menu` for right-click on a node, `#help-overlay` for `?`, `#palette-overlay` for command palette, `#wiki-autocomplete` for `[[` link completion.

## 6. IndexedDB Schema

The database is named `local-outline` and currently runs at version 2. Both versions are declared so existing installs upgrade in place.

### 6.1 Schema Declarations ([index.html:726-750](index.html#L726-L750))

```js
const db = new Dexie('local-outline')

db.version(1).stores({
  vaultMeta:        'id',
  keyRecords:       'id',
  encryptedRecords: 'id, store, updatedAt',
  encryptedAssets:  'id, kind, updatedAt',
  appState:         'key',
})

db.version(2).stores({
  vaultMeta:        'id',
  keyRecords:       'id, vaultId',
  encryptedRecords: 'id, store, vaultId, updatedAt',
  encryptedAssets:  'id, kind, vaultId, updatedAt',
  appState:         'key',
}).upgrade(async tx => {
  // Tag legacy records with the synthetic 'vault' id so multi-vault queries work.
  await tx.table('encryptedRecords').toCollection().modify(r => { if (!r.vaultId) r.vaultId = 'vault' })
  await tx.table('encryptedAssets').toCollection().modify(r  => { if (!r.vaultId) r.vaultId = 'vault' })
  // Rename the single legacy key record into the new keyed-by-vault scheme.
  const oldKey = await tx.table('keyRecords').get('vaultKey-v1')
  if (oldKey) {
    await tx.table('keyRecords').put({ ...oldKey, id: 'vaultKey-vault-v1', vaultId: 'vault' })
    await tx.table('keyRecords').delete('vaultKey-v1')
  }
  // Give the legacy vault a default display name.
  const v = await tx.table('vaultMeta').get('vault')
  if (v && !v.name) await tx.table('vaultMeta').put({ ...v, name: 'Default', createdAt: Date.now() })
})
```

The v1 → v2 migration adds a `vaultId` index to every per-vault table and renames the legacy single-vault key record. The synthetic id `'vault'` is used for legacy data so that pre-multi-vault installs continue to work without user intervention.

### 6.2 Store Contracts

| Store | Key | Indices | Holds |
|---|---|---|---|
| `vaultMeta` | `id` (UUID, or `'vault'` for legacy) | — | One row per vault: `{id, name, salt, kdf, kdfSpec, keyVersion, createdAt}` |
| `keyRecords` | `id` (`vaultKey-{vaultId}-v{N}`) | `vaultId` | One row per (vault, keyVersion): `{id, vaultId, version, wrappedKey, iv}` |
| `encryptedRecords` | `id` | `store, vaultId, updatedAt` | Encrypted documents and nodes: `{id, store, vaultId, updatedAt, ciphertext, iv}` |
| `encryptedAssets` | `id` | `kind, vaultId, updatedAt` | Encrypted binary assets (images): `{id, kind, vaultId, updatedAt, ciphertext, iv}` |
| `appState` | `key` | — | Plaintext UI/runtime state: theme, autoLockMinutes, per-vault auto-snapshot directory handle |

`encryptedRecords.store` distinguishes the logical kind of record inside the encrypted blob: `'document'` for document metadata, `'node'` for tree nodes. Both share one table because the per-record schema is opaque — only the wrapped JSON inside `ciphertext` knows.

`appState` is intentionally plaintext. It holds only non-content settings (theme choice, auto-lock duration, the per-vault auto-snapshot directory handle). No user content is stored here.

### 6.3 Index Use

Reads are almost always full-table scans within a vault: on unlock the app loads every `encryptedRecords` row where `vaultId === ctx.vaultId`, decrypts each, and builds the in-memory `state.nodes` array. The `vaultId` index is what makes that scan cheap on machines with multiple vaults. The `updatedAt` index is reserved for future incremental sync work and is not currently the hot path.

## 7. Vault and Encryption Architecture

All encryption happens in [index.html:752-936](index.html#L752-L936). The design rests on a wrapped-key scheme: a random vault key encrypts content; a password-derived key encrypts the vault key.

### 7.1 Key Hierarchy

```text
User password
  -> KDF(password, salt)                 (Argon2id preferred, PBKDF2 fallback)
  -> password-derived key

Random 256-bit vault key                 (per-vault, never persisted in plaintext)
  -> encrypts/decrypts all records and assets

password-derived key
  -> wraps/unwraps the vault key only    (stored in keyRecords as wrappedKey+iv)
```

The vault key is generated with `crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [...])` at vault creation and wrapped with the password-derived key. The wrapped form lives in `keyRecords`. The unwrapped form is held in memory inside `ctx` only while the vault is unlocked.

### 7.2 KDF Parameters

Argon2id (preferred, via `hash-wasm`):

| Parameter | Value | Source |
|---|---|---|
| Variant | argon2id | — |
| Time (iterations) | 3 | `ARGON2_PARAMS.time` |
| Memory | 65,536 KiB (64 MiB) | `ARGON2_PARAMS.memory` |
| Parallelism | 1 | `ARGON2_PARAMS.parallelism` |
| Hash length | 32 bytes | `ARGON2_PARAMS.hashLen` |
| Salt | 32 random bytes per vault | `crypto.getRandomValues` |

PBKDF2 fallback (used when the Argon2id WASM cannot load):

| Parameter | Value |
|---|---|
| Hash | SHA-256 |
| Iterations | 600,000 (`PBKDF2_ITERATIONS`) |
| Salt | 32 random bytes |

`pickKdfSpec()` returns `{ spec, fallback }` — `fallback: true` means Argon2id was unavailable and PBKDF2 was used instead.

### 7.3 Content Encryption

AES-GCM with a fresh 12-byte IV per ciphertext. `aesEncrypt` returns `{ ciphertext, iv }` as `Uint8Array`; the persistence helpers base64-encode both. Decryption is symmetric. The vault context object created by `makeCtx(vaultKey, vaultId)` exposes `encrypt(bytes)` and `decrypt(ciphertext, iv)` and is the only handle through which application code accesses the vault key.

### 7.4 Vault Creation (`initVault`)

1. Generate a UUID for the vault id.
2. `pickKdfSpec()` → derive `passwordKey` from the user's password and a fresh salt.
3. Generate a random 256-bit AES-GCM `vaultKey` (extractable, so it can be wrapped).
4. Wrap `vaultKey` with `passwordKey` under a fresh 12-byte IV.
5. Persist:
   - `vaultMeta` row: `{id, name, salt, kdf, kdfSpec, keyVersion: 1, createdAt}`.
   - `keyRecords` row keyed `vaultKey-{id}-v1`: `{id, vaultId, version, wrappedKey, iv}`.
6. Re-import the vault key as non-extractable for runtime use and return a `ctx` bound to it.

### 7.5 Vault Unlock and Silent KDF Migration (`unlockVault`)

1. Load `vaultMeta`; build `kdfSpec` (legacy rows without `kdfSpec` are interpreted as PBKDF2 against the top-level salt).
2. Derive `passwordKey` from the supplied password.
3. Load the `keyRecords` row for the current `keyVersion` and `unwrapKey` the vault key.
4. If the current spec is PBKDF2 **and** Argon2id is now available, perform a silent in-place migration:
   - Build a new Argon2id `kdfSpec` with a fresh salt.
   - Derive a new password key, wrap the same vault key under it with a fresh IV.
   - Bump `keyVersion` and write a new `keyRecords` row first, then update `vaultMeta`, then delete the old `keyRecords` row. This ordering guarantees that a crash mid-migration always leaves a working key on disk.
   - Failures here are logged and ignored; the PBKDF2 record is kept.
5. Re-import the vault key as non-extractable and return a `ctx`.

### 7.6 Password Change (`changeVaultPassword`)

The vault key itself does **not** change on password change. The function:

1. Unwraps the existing vault key with the old password.
2. Picks a fresh KDF spec and derives a new password key.
3. Re-wraps the same vault key under the new password key with a fresh IV.
4. Writes back to `vaultMeta` (updated `salt`, `kdf`, `kdfSpec`) and the same `keyRecords` row (updated `wrappedKey`, `iv`).

`keyVersion` is intentionally not incremented — only the silent Argon2id migration bumps it. Because the vault key is unchanged, no encrypted records or assets need to be re-encrypted.

### 7.7 Multi-Vault Model

Every vault has its own row in `vaultMeta`, its own keyRecords, and its own salt. Records and assets carry a `vaultId` field; queries always filter on it. Switching vaults requires re-entering the new vault's password (the current vault key is dropped). There is no cross-vault search and no shared content.

### 7.8 Deletion

`deleteVault(vaultId)` removes the meta row, every key record, every encrypted record, and every encrypted asset for that vault. The wrapped key is destroyed along with everything that depended on it, so the data is unrecoverable even if the underlying IDB pages have not yet been overwritten by the storage engine.

## 8. Node Data Model

A document is a tree of typed nodes scoped to a single `documentId`. Each node is one row in `state.nodes` and one encrypted record in `encryptedRecords`.

### 8.1 Node Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (UUID) | yes | Primary key, generated by `crypto.randomUUID()` |
| `parentId` | string \| null | yes | Parent node id; `null` for root-level nodes |
| `documentId` | string | yes | Owning document id |
| `order` | string | yes | Fractional index produced by `generateKeyBetween` |
| `kind` | `'text'` \| `'checkbox'` \| `'code'` \| `'image'` | yes | Node kind |
| `content` | string | yes | For text/checkbox: body text. For code: language label. For image: MIME type |
| `codeBody` | string | code only | Source for code nodes |
| `checked` | boolean | checkbox only | Checkbox state |
| `collapsed` | boolean | optional | Whether children are hidden |
| `assetId` | string | image only | Foreign key into `encryptedAssets` |
| `cardStats` | object | optional | SM-2 state for nodes promoted to flashcards (see §14) |
| `cardClozeStats` | `Record<group, stats>` | cloze cards only | Per-group SM-2 state for cloze cards |
| `cardSuspended` | boolean | optional | User-suspended card (kept indexed, never scheduled) |
| `cardHistory` | array | optional | Review log, capped (see §14) |
| `createdAt` | number | yes | `Date.now()` |
| `updatedAt` | number | yes | `Date.now()`; bumped on every mutation |

### 8.2 Fractional Ordering

Sibling order is a string produced by `generateKeyBetween(prev, next)` from `fractional-indexing`. Inserting between two siblings yields a new key strictly between their keys; moving a node updates only that single field. Reorder operations therefore never trigger a renumber pass and never require updating siblings.

When a node moves to a new parent (indent, outdent, move), its `parentId` and `order` are recomputed; nothing else changes. This is what keeps undo entries (which snapshot the full `state.nodes` array — see §9) cheap to construct.

### 8.3 Tree Reconstruction

The tree is not stored as a tree — it is stored as a flat array with `parentId` and `order` on each row. `sortedChildren(nodes, parentId, docId)` filters and sorts on demand; `getDescendants` walks the children recursively. The renderer (`renderTree`) walks from the root (or from the zoom target) and emits DOM.

### 8.4 Documents

Documents have their own minimal record (id, title, createdAt, updatedAt) stored in `encryptedRecords` with `store: 'document'`. The sidebar lists them by recency; selecting one filters `state.nodes` by `documentId` for rendering.

## 9. Node Operations and Undo / Redo

Operations are pure functions in [index.html:1058-1201](index.html#L1058-L1201). Each takes the current node array and returns `{ nodes, delta, deletedIds, newId? }` — a new array plus the per-node delta needed to persist the change. They never mutate inputs.

### 9.1 Operations

| Op | Effect |
|---|---|
| `opInsert(nodes, docId, parentId, afterNode, kind)` | Create a new node after `afterNode` (or at end if null) |
| `opDelete(nodes, nodeId)` | Remove a node and all its descendants |
| `opIndent(nodes, nodeId)` | Move under the previous sibling as last child |
| `opOutdent(nodes, nodeId)` | Move out one level, placed just after the former parent |
| `opMove(nodes, nodeId, targetParentId, afterNode)` | Reparent / reorder via drag-drop |
| `opToggleCollapse(nodes, nodeId)` | Flip `collapsed` on one node |
| `opExpandAll(nodes, nodeId)` | Expand every descendant of the node |
| `opExpandToLevel(nodes, nodeId, maxDepth)` | Expand to a given depth, collapse below it |
| `opExpandSiblings(nodes, nodeId)` | Expand all siblings of the node |
| `opSortChildren(nodes, nodeId, dir)` | Sort direct children alphabetically (asc/desc) |
| `opToggleCheck(nodes, nodeId)` | Flip `checked` on a checkbox node |
| `opChangeKind(nodes, nodeId, kind)` | Convert node between text / checkbox / code / image |
| `opChildrenToCheckbox(nodes, nodeId)` | Promote every non-checkbox child to a checkbox |
| `opDeleteChecked(nodes, nodeId)` | Delete every checked descendant |
| `opNumberChildren(nodes, nodeId)` | Toggle `1. 2. 3.` numbering on direct children |
| `opChangeCodeLang(nodes, nodeId, lang)` | Update the language tag (which is `content`) on a code node |
| `opGradeCard(nodes, nodeId, rating, clozeGroup)` | Apply SM-2 grading to a card node (see §14) |

### 9.2 The `applyOp` Pipeline

`applyOp(result)` ([index.html:3335-3359](index.html#L3335-L3359)) is the standard dispatcher. It:

1. Pushes a `{ before, after }` snapshot onto the undo stack.
2. Sets `state.nodes = result.nodes`.
3. For each delta node: updates the in-memory search index and persists via `putNodes(delta, ctx)`.
4. For each deleted id: removes from the search index and from IndexedDB.
5. Re-renders the tree and the tag list.
6. Refreshes the per-document due counter (for `@card:due` postings).

### 9.3 Undo and Redo

The undo stack stores full-array snapshots, capped at `HISTORY_LIMIT = 200` entries ([index.html:3290-3300](index.html#L3290-L3300)). Snapshots are cheap because operations return new arrays sharing all unchanged element references. `undo()` and `redo()` call `applySnapshot(from, to)`, which diffs the two arrays to compute which records to persist and which to delete, and tears down or rebuilds CodeMirror instances accordingly. Bindings: `Ctrl+Z` and `Ctrl+Shift+Z`.

### 9.4 The `applyReview` Pipeline

Card grading uses a parallel dispatcher `applyReview(result)` ([index.html:3366+](index.html#L3366)) that runs the same persistence + indexing path but deliberately:

- **Does not push to the undo stack** — grading should not pollute the 200-entry history.
- **Does not call `renderTree`** — a 100-card session would otherwise force 100 full re-renders. The card pill is patched in place via `refreshCardPill`.

## 10. Editor and Inline Rendering

Plain text nodes are edited with `contenteditable` directly on the `.node-text` element. Inline rendering is layered on top of the raw text without mutating the underlying `content` string. Code nodes use a per-node CodeMirror view (§11) and image nodes use a `<img>` produced from an encrypted blob (§12).

### 10.1 Inline Renderer

Markdown-it is created once: `const mdParser = new MarkdownIt({ breaks: true })` ([index.html:1398](index.html#L1398)). Inline rendering goes through `mdParser.renderInline(text)`, which produces inline markup only — no paragraph wrapping. `applyRichRender(el, text)` ([index.html:2098-2101](index.html#L2098-L2101)) then routes content to:

- Inline links (`[label](url)`) → safe `<a class="inline-link">` tags.
- Wiki links (`[[title]]`) → `<a class="wiki-link">` resolved via the inverted index `wiki:<title>` postings.
- Node refs (`((uuid))`) → `<a class="node-link">` resolved against the node table.
- KaTeX math (`$…$` and `$$…$$`) → rendered via `katex.renderToString`; the host node receives `.has-math` for styling.
- Plain text → escaped and inserted.

The raw text the user typed is never overwritten by rendered output. The render pass only annotates the DOM; on focus the contenteditable shows the raw source for editing.

### 10.2 Wiki Autocomplete

Typing `[[` opens the `#wiki-autocomplete` popup, populated from document titles and currently-indexed wiki tokens. Selection inserts the chosen title between the brackets.

### 10.3 Tags and Due Dates

Tags (`#tagname`) and due markers (`@YYYY-MM-DD` on checkbox nodes) are recognised by the indexer and surfaced in the sidebar Tags section / sidebar due counter. They are styled inline but remain plain text in `content`.

## 11. Code Block Editing

Code nodes are edited with CodeMirror 6. Each visible code node owns one `EditorView` registered in the `cmInstances` Map ([index.html:2920-2956](index.html#L2920-L2956)).

### 11.1 EditorView Construction

For each code node that appears in the rendered tree:

```js
new EditorView({
  doc: node.codeBody ?? '',
  extensions: [
    basicSetup,
    oneDark,
    getCMLang(node.content),         // language extension from the language label
    EditorView.updateListener.of(update => {
      if (!update.docChanged) return
      // Debounced 300ms: persist new codeBody to IndexedDB
    })
  ],
  parent: el,
})
```

`node.content` doubles as the language label (e.g. `"javascript"`, `"py"`, `"md"`); `getCMLang` normalises aliases (`c`/`cpp`/`c++` → `cpp`, `md`/`markdown` → `markdown`, `jl`/`julia` → `julia`) and returns the right language extension. Persistence is debounced 300 ms after the last keystroke; both `state.nodes` and the encrypted record are updated, but no undo entry is pushed (CodeMirror's own undo handles in-editor keystrokes).

### 11.2 Language Modes

12 modes are bundled from `libs/deps.js`:

| Mode | Aliases | Extension |
|---|---|---|
| JavaScript | `js`, `javascript` | `javascript()` |
| Python | `py`, `python` | `python()` |
| Markdown | `md`, `markdown` | `markdownLang()` |
| CSS | `css` | `css()` |
| HTML | `html` | `html()` |
| JSON | `json` | `json()` |
| SQL | `sql` | `sql()` |
| Rust | `rust`, `rs` | `rust()` |
| C++ | `c`, `cpp`, `c++` | `cpp()` |
| Java | `java` | `java()` |
| Julia | `jl`, `julia` | `StreamLanguage.define(julia)` |
| R | `r` | `StreamLanguage.define(r)` |

### 11.3 Lifecycle

`renderTree` tracks which code nodes are currently visible (`neededCM` set). Nodes that scroll out of the visible tree or are removed have their CodeMirror view destroyed via `destroyCM(id)`. Nodes that come back into view are reattached if their view still exists, or constructed fresh otherwise. Collapsing a parent and undoing/redoing both go through this path.

## 12. Image Handling

Images are first-class node kinds. They are pasted from the clipboard, encrypted, and persisted as binary blobs in `encryptedAssets`.

### 12.1 Paste Pipeline

The global paste handler ([index.html:4437-4454](index.html#L4437-L4454)) inspects `clipboardData.items` for an `image/*` entry. On a hit:

1. Reject blobs larger than 5 MB with an inline alert: `Image exceeds 5 MB limit.`
2. Read the blob as a `Uint8Array`.
3. `putAsset(id, kind, bytes, ctx)` encrypts the bytes with the vault context and writes one row to `encryptedAssets`.
4. Create a new node with `kind: 'image'`, `content: <mimeType>`, `assetId: id`.
5. `applyOp(opInsert ...)` persists the new node in the standard way.

### 12.2 Display

On render, image nodes look up the asset by id, decrypt the bytes, and create a blob URL: `URL.createObjectURL(new Blob([bytes], { type: node.content }))` ([index.html:3065-3066](index.html#L3065-L3066)). The URL is set as `src` on an `<img>` element. Blob URLs are revoked when the node leaves the DOM.

### 12.3 Export Behaviour

- **Markdown export** writes `![image](asset:<id>)` — a non-resolvable placeholder that preserves the reference but does not embed the bytes. Importing such Markdown will not restore the image.
- **HTML export** decrypts each asset and embeds it as a `data:` URI; the resulting file is fully self-contained.
- **Encrypted snapshot** includes the encrypted asset bytes verbatim so a snapshot round-trip preserves all images.

## 13. Search

The in-memory inverted index in [index.html:1811-1970](index.html#L1811-L1970) is the single source of truth for both the search overlay and several sidebar surfaces (tag list, due counter, backlinks).

### 13.1 Data Structures

```js
const searchIndex = {
  postings:    Map<string token, Set<nodeId>>
  nodeTokens:  Map<nodeId, Set<string token>>
  nodeMeta:    Map<nodeId, { docId, kind, content, updatedAt, checked, excerpt }>
  extractors:  Array<(node) => Iterable<string>>
}
```

`postings` is the inverted index. `nodeTokens` enables clean removal on edit or delete. `nodeMeta` holds the small projection needed to render result rows without redecrypting.

### 13.2 Extractors

Five extractors are registered in order ([index.html:1838-1921](index.html#L1838-L1921)):

| Extractor | Token format | Source field |
|---|---|---|
| `wordExtractor` | lowercased word | `content` (and `codeBody` for code nodes) |
| `tagExtractor` | `#tagname` | `#`-prefixed words in `content` |
| `linkExtractor` | `wiki:<title>`, `noderef:<uuid>` | `[[…]]` and `((…))` patterns |
| `dueExtractor` | `@due:YYYY-MM-DD`, `@due:today`, `@due:overdue`, `@due:thisweek` | `@YYYY-MM-DD` on checkbox nodes |
| `cardExtractor` | `@card`, `@card:<kind>`, `@card:new`, `@card:due`, `@card:reverse`, `@card:suspended` | `@card …` directives parsed by `parseCard()` |

All tokens share one inverted index, so tag, link, due, and card filters use the same code path as word search. Bucket tokens such as `@due:today` are re-derived against the current date on every index pass.

### 13.3 Build, Update, Tear-Down

`indexNode(node)` is called every time a node is created or modified. It first unindexes the previous version (if any), runs every extractor, stores the union of tokens, and updates `nodeMeta`.

The full index is rebuilt on vault unlock, after every node is decrypted. The index is wiped on vault lock and on app shutdown — it lives only in memory and is never persisted.

### 13.4 Query

The search overlay (`Ctrl+Shift+F`) tokenises the query the same way `tokenizeWords` does, intersects the postings sets, and groups results by `docId`. Tag clicks in the sidebar issue a query for the `#tag` token; the due counter counts postings for `@card:due` and `@due:overdue`.

## 14. Spaced-Repetition Study Mode

A text node becomes a flashcard when its content contains a `@card …` directive parsed by `parseCard`. Promotion is lazy: the node remains a regular text node in every other respect, and its `cardStats` (and for cloze cards, `cardClozeStats`) are allocated on first grade.

### 14.1 Card Discovery

The `cardExtractor` emits the tokens listed in §13.2 so the standard search index also serves as the card index. Filtering for `@card:due` returns every card whose `cardStats.nextDueAt` is in the past. Cloze cards aggregate the soonest `nextDueAt` across their groups; if any group is overdue the whole card counts as due.

### 14.2 Card Stats Schema

`defaultCardStats()` ([index.html:708-720](index.html#L708-L720)) defines the canonical default:

```js
{
  totalReviews: 0,
  successfulReviews: 0,
  failedReviews: 0,
  intervalDays: 0,
  ease: 2.5,
  masteryPercent: 0,
  failedRecently: false,
  nextDueAt: null,
  lastSeenAt: null,
}
```

Cloze cards keep one such object per group in `cardClozeStats[group]` and use the top-level `cardStats` only as a roll-up.

### 14.3 Grading

`opGradeCard(nodes, nodeId, rating, clozeGroup)` applies a ported SM-2 update to a copy of the relevant stats, appends an entry to `cardHistory` (capped), and returns through the standard op shape. It is dispatched via `applyReview` rather than `applyOp` (see §9.4) so it does not consume undo entries and does not force a full re-render.

### 14.4 Study Overlay

`#study-overlay` is the dedicated review surface. It enumerates due cards in the current document (or across the vault), shows the prompt, supports a flip control to reveal the answer, and offers grade buttons. The overlay closes when the session is exhausted.

### 14.5 Relationship to the Flash App

This study mode is the surface area where the sibling flash app can integrate. The phased integration design lives in [combined_app/plan/](../plan/) (`phase-1-parser-extractor.md` through `phase-8-flash-import.md`). The outliner already imports flash card / deck JSON into outliner nodes (see §15.3); deeper integration is tracked there.

## 15. Import Workflows

### 15.1 Markdown Import (`importMarkdown`)

Implemented at [index.html:1522-1579](index.html#L1522-L1579). The parser walks the file line by line maintaining a depth stack of `{ parentId, lastOrder, lastId }` entries. Indentation is interpreted as two spaces per level (`depth = floor(indent / 2)`). Recognised forms:

- A leading `# Title` line becomes the document title; if absent, the document is named `Imported`.
- `- text` becomes a text node at the indicated depth.
- `- [ ] text` and `- [x] text` (case-insensitive `x`/`X`) become checkbox nodes with the corresponding `checked` flag.
- ```` ```lang ```` opens a fenced code block; everything up to the next ` ``` ` is collected into `codeBody`, and the language label after the fence becomes `content`.

Other Markdown features (headings beyond `#`, ordered lists, blockquotes, paragraphs without a leading `-`) are ignored. A round-trip through `exportMarkdown` → `importMarkdown` preserves bullet structure, checkbox state, and code blocks but does not preserve images (the export emits a placeholder reference that the import does not resolve).

The user triggers Markdown import from the Import modal (`#import-modal`); the result is added as a fresh document in the current vault.

### 15.2 Encrypted Snapshot Import (`importSnapshot`)

Implemented at [index.html:1380-1396](index.html#L1380-L1396). Triggered from the vault picker (`#vault-snap-modal`) because importing a snapshot creates a new vault.

1. Parse the JSON envelope; reject if `app !== 'local-outline'` or `encrypted !== true`.
2. Read `salt` and `iv` from `encryption`.
3. Derive a snapshot key with `deriveKey(password, salt)` — using the legacy `Uint8Array` shorthand, which means the snapshot is always decrypted with PBKDF2 regardless of which KDF the source vault used internally (see §17.3).
4. Decrypt the ciphertext; surface "Incorrect password or corrupted snapshot." on failure.
5. Create a brand-new vault with `initVault(name, password)` — this generates fresh vault metadata, a fresh vault key, and a fresh KDF spec (Argon2id if available).
6. Re-encrypt every document, node, and asset under the new vault key.

The result is a vault that holds the same content but does not share encryption material with the source vault.

### 15.3 Flash Card / Deck Import (`importFlashDeck`)

Implemented at [index.html:1581-1696](index.html#L1581-L1696). Accepts three JSON shapes from the sibling flash app: card-only export (`{decks, cards}`), single-deck export (`{deck, cards}`), and a full flash snapshot (`{snapshotVersion, database: {decks, cards, …}}`).

Conversion rules (`flashCardToText`):

- **Standard cards**: emitted as `@card <front> :: <back>`. Three-or-more-side cards are joined with ` / ` on the back and counted as lossy.
- **Cloze cards**: emitted as `@card <text>` preserving the cloze syntax. Per-group review stats from `clozeCard.groupStats` are carried over into `cardClozeStats`.
- **Text-memory cards** are lossily converted to `@card <title> :: <text>` and counted.
- Deleted (`deletedAt`) and unsupported types are skipped.

`cardStats` is carried across verbatim for every supported card, so the imported nodes are immediately due-aware. The result is a new document titled `Imported from flash: <deckName>` (or just `Imported from flash`). A summary alert reports lossy counts and skips; full detail goes to the console.

## 16. Export Workflows

### 16.1 Markdown Export (`exportMarkdown`)

Implemented at [index.html:1400-1421](index.html#L1400-L1421). Emits a document as nested bullets at two-spaces-per-depth indentation. Per-kind formatting:

| Kind | Format |
|---|---|
| text | `- <content>` |
| checkbox | `- [x] <content>` or `- [ ] <content>` |
| code | ```` ```<lang>\n<codeBody>\n``` ```` at the node's indent |
| image | `- ![image](asset:<assetId>)` — the asset bytes are not embedded |

The export covers a single document. Round-trip with `importMarkdown` is lossless for all kinds except images.

### 16.2 Self-Contained HTML Export (`exportHtml`)

Implemented at [index.html:1425-1520](index.html#L1425-L1520). Produces a stand-alone HTML file with inline CSS, rendered inline Markdown, KaTeX-rendered math, and images embedded as `data:` URIs.

- Math is extracted before Markdown rendering via a slot mechanism (placeholders like `KATEXSLOT0KATEXEND`) so markdown-it does not see `$…$`. Each slot is rendered with `katex.renderToString({ displayMode })` and substituted back after Markdown inline rendering. On failure the original `$…$` text is preserved.
- Code nodes render as `<pre><code class="lang-…">` with HTML-escaped body.
- Image nodes render as `<img src="data:<mime>;base64,…">` after decrypting the asset bytes.
- Checkbox nodes render as `<label><input type="checkbox" disabled [checked]><span>…</span></label>`.
- A small inline stylesheet and a single KaTeX CSS `<link>` to `cdn.jsdelivr.net` make the file viewable without any further resources (the KaTeX `<link>` is the only external dependency; the rendered math itself is already inlined).

The HTML export is the only export that embeds image bytes.

### 16.3 Encrypted Snapshot Export (`exportSnapshot`)

Implemented at [index.html:1365-1378](index.html#L1365-L1378). Triggered from the Export modal (snapshot tab) after re-entering the vault password.

1. Collect every document, every node, and every asset for the current vault. Assets are read decrypted from `getAsset` and re-base64-encoded into the payload.
2. Build the payload `{ documents, nodes, assets }` and JSON-encode it.
3. Generate a fresh 32-byte salt; derive a fresh PBKDF2 key from the user-supplied password.
4. AES-GCM encrypt with a fresh 12-byte IV.
5. Wrap as the snapshot envelope (see §17) and return as a pretty-printed JSON string for the user to save.

### 16.4 Print / PDF

The print tab opens the browser's print dialog. The print stylesheet at [index.html:423-444](index.html#L423-L444) hides every modal, the sidebar, the add bar, the status bar, the card pill, the breadcrumb, and the wiki autocomplete; forces black-on-white colours; renders the outline tree as visible bullets; and inlines code blocks with a light border. Users choose "Save as PDF" as the destination to produce a PDF copy.

### 16.5 Auto-Snapshot Directory

The sidebar Enable auto-snapshot button uses the File System Access API (`showDirectoryPicker`) to obtain a persistent directory handle. The handle is stored in `appState` keyed `autoSnapshotDir-{vaultId}`. While the handle is granted, the app writes a fresh encrypted snapshot to that directory on a schedule. The handle is per-vault and only used when permissions remain granted; otherwise the button re-prompts.

## 17. Snapshot Format

### 17.1 Envelope

```json
{
  "app": "local-outline",
  "snapshotVersion": 1,
  "encrypted": true,
  "createdAt": 1778520000000,
  "vaultName": "Personal",
  "encryption": {
    "algorithm": "AES-GCM",
    "kdf": "pbkdf2",
    "salt": "base64...",
    "iv": "base64...",
    "keyVersion": 1
  },
  "ciphertext": "base64..."
}
```

### 17.2 Plaintext Payload

The decrypted ciphertext is a UTF-8 JSON string of the shape:

```json
{
  "documents": [ { "id": "...", "title": "...", "createdAt": ..., "updatedAt": ... } ],
  "nodes":     [ { "id": "...", "documentId": "...", "parentId": ..., "order": "...", "kind": "...", "content": "...", ... } ],
  "assets":    [ { "id": "...", "kind": "image", "data": "base64..." } ]
}
```

Assets are base64-encoded plaintext bytes; the snapshot is the only place asset bytes leave the database in plaintext (and only to be re-encrypted by the snapshot key two lines later).

### 17.3 KDF Caveat

The snapshot uses **PBKDF2** regardless of the source vault's KDF. This is a deliberate format choice: snapshots can be opened by `importSnapshot` even when Argon2id is unavailable, and the snapshot-key derivation is self-contained (no dependency on the source vault's `keyRecords`). The source vault retains whatever KDF its `vaultMeta` says.

### 17.4 Round-Trip Semantics

A snapshot round-trip preserves: every document and node verbatim, every image byte, every `cardStats` / `cardClozeStats` field, fractional order, and `createdAt` / `updatedAt`. It does **not** preserve: the source vault id, vault key, `keyRecords`, in-memory undo history, or the search index (rebuilt on first unlock).

## 18. Security and Privacy

### 18.1 Zero-Knowledge Architecture

There is no server. The password never leaves the device. The wrapped vault key on disk is useless without the password. Anyone with access to the IndexedDB pages sees only ciphertext and KDF parameters.

### 18.2 No Telemetry

There are no analytics, error-reporting, or remote-logging hooks. The only network requests the app makes are the initial loads of `index.html`, `libs/deps.js`, the manifest, the icons, and (on first load) the KaTeX CSS/JS from `cdn.jsdelivr.net`. The service worker caches those and serves them locally on subsequent loads.

### 18.3 Auto-Lock

Implemented at [index.html:2350-2377](index.html#L2350-L2377). Default 15 minutes (`AUTO_LOCK_DEFAULT_MINUTES`), persisted in `appState.autoLockMinutes`. Setting the value to `0` disables auto-lock.

The timer is reset by any `keydown`, `pointerdown`, or `visibilitychange` event (all registered in capture phase, passive). When it fires, `lockVault()` discards the in-memory vault key, clears the search index, drops `state.nodes`, and re-renders to the unlock screen.

### 18.4 Password Change Caveats

As noted in §7.6, changing the vault password re-wraps the same vault key under a new password key. Implications:

- An attacker who captured the on-disk state at any earlier time can still decrypt all records they saw, because the vault key did not change.
- Re-encrypting every record would force a full read/re-write cycle for the whole vault; the design deliberately trades that for fast password changes.
- True key rotation (a brand-new vault key) is not exposed in the UI; users who need it can export a snapshot and import it back as a new vault.

### 18.5 IndexedDB Quota and Eviction

Browsers may evict IndexedDB data under storage pressure. Users with large vaults (especially many image nodes) are encouraged to maintain regular encrypted-snapshot backups via the auto-snapshot feature, since IDB is not durable storage by web-platform contract.

## 19. Offline Support and PWA

### 19.1 Manifest (`manifest.webmanifest`)

```json
{
  "name": "Local Outline",
  "short_name": "Outline",
  "description": "Encrypted local-first outliner",
  "start_url": "./",
  "display": "standalone",
  "background_color": "#141414",
  "theme_color": "#1a1a1a",
  "orientation": "any",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

### 19.2 Service Worker (`sw.js`)

The whole service worker is 37 lines. Strategy: precache the static shell on install, cache-first on fetch, and opportunistically cache the KaTeX CDN responses on first hit.

```js
const CACHE = 'outline-v3'
const PRECACHE = [
  './', './index.html', './libs/deps.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png',
]

// install: cache the precache list and skipWaiting
// activate: delete every cache that is not CACHE; clients.claim()
// fetch:    cache.match → if hit, return; else network; if URL contains
//           'jsdelivr.net', tee the response into the cache for next time
```

Bumping the `CACHE` constant (currently `outline-v3`) is how a new release force-refreshes installed clients.

### 19.3 Install Prompt

`index.html:5601+` installs a small "Add to Home Screen" banner for iOS / Android browsers where the install prompt is not surfaced automatically. The user's dismissal is remembered in `localStorage` under `outlineInstallHintDismissed`.

### 19.4 Service Worker Registration

```js
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
}
```

Registered at the bottom of the module body ([index.html:5597-5599](index.html#L5597-L5599)) after `init()` so the first paint is not blocked by SW registration.

## 20. Error Handling

The app surfaces errors through three channels:

### 20.1 Inline Modal Errors

Each modal has a `.error-msg` element (e.g. `#vnew-error`, `#vunlock-error`, `#exp-error`, `#imp-error`, `#vsnap-error`, `#vchpass-error`). A `setErr(id, msg)` helper writes the text and styles the row. Recoverable failures clear the error on the next submit attempt.

### 20.2 Operation-Specific Failure Modes

| Operation | Failure | Message |
|---|---|---|
| Create vault | Password too short / confirm mismatch | "Password must be at least 8 characters." / "Passwords do not match." |
| Unlock vault | Wrong password | "Incorrect password." |
| Change password | Wrong current password | "Current password is incorrect." |
| Import snapshot | Not a snapshot file | "Invalid snapshot." |
| Import snapshot | Wrong password / tampered bytes | "Incorrect password or corrupted snapshot." |
| Create vault, Argon2id unavailable | KDF warning shown inline ([index.html:522](index.html#L522)) | "Argon2id unavailable (offline?) … will silently upgrade on the next online unlock." |

The wrong-password / corrupted-snapshot collapse is intentional: distinguishing the two would leak information about whether the file was a real snapshot for that password.

### 20.3 Async / Background Failures

Background paths log to the browser console:

- KDF migration failure during unlock (`Argon2id migration failed; keeping PBKDF2 record:`) — the user keeps unlocking with PBKDF2.
- Flash-import skips and lossy conversions (`[flash-import] skipped …`, `[flash-import] standard card has N sides …`).
- File-System Access permission revocation falls back to re-prompting on the next auto-snapshot tick.

There is no central error-boundary UI; uncaught errors are visible in the browser console.

### 20.4 IndexedDB Quota Exceeded

Dexie rejects writes that exceed quota. Today this surfaces as a rejected promise that the calling op rejects upward; users see no specific message. Documented as a future-work item (§24).

## 21. Keyboard Shortcuts

The full table from `SHORTCUTS` at [index.html:2461-2478](index.html#L2461-L2478):

| Action | Keys | Description |
|---|---|---|
| toggle-collapse | `Ctrl+.` | Collapse / expand node |
| expand-all | `Ctrl+Shift+.` | Expand all descendants |
| insert-below | `Enter` | Add node below |
| zoom | `Ctrl+]` | Zoom into node |
| delete | `Ctrl+Shift+⌫` | Delete node |
| move-up | `Ctrl+↑` | Move node up |
| move-down | `Ctrl+↓` | Move node down |
| indent | `Tab` | Indent |
| outdent | `Shift+Tab` | Outdent |
| add-checkbox | `Ctrl+Shift+C` | Add checkbox |
| check-off | `Ctrl+/` | Toggle checkbox |
| number-children | `Ctrl+Shift+X` | Number children |
| undo | `Ctrl+Z` | Undo |
| redo | `Ctrl+Shift+Z` | Redo |
| search | `Ctrl+Shift+F` | Search all |
| help | `?` | Show this help |

Sixteen entries. `Ctrl` is interpreted as the platform's primary modifier (`Cmd` on macOS) by the keydown handler. Bindings inside an open CodeMirror editor are scoped to CodeMirror (e.g. `Tab` indents the code, not the outline). Single-character bindings like `?` only fire when no input element is focused.

## 22. Styling, Theming, and Print

### 22.1 CSS Custom Properties

The entire palette is defined as CSS variables on `:root` ([index.html:11-69](index.html#L11-L69)) and overridden on `:root.light` ([index.html:71-128](index.html#L71-L128)). Variable families:

- Backgrounds: `--bg`, `--bg-1`, `--bg-2`, `--bg-3`, `--bg-3-hover`, `--bg-4`, `--bg-list-active`, `--bg-add-bar`, `--bg-input`.
- Borders: `--border`, `--border-soft`, `--border-softer`, `--border-bg`, `--border-input`, `--border-secondary-hover`, `--vault-divider`, `--ctx-sep`.
- Text: `--text`, `--text-muted`, `--text-dim`, `--text-soft`, `--text-faint`, `--text-fainter`, `--text-faintest`, `--text-ghost`, `--text-placeholder`.
- Semantic: `--accent`, `--accent-hover`, `--accent-on`, `--danger`, `--selected`, `--selected-text`, `--selected-border`, `--inline-link`, `--wiki-link`, `--mark-bg`, `--autosnap-active-*`.
- Overlays / shadows: `--overlay`, `--overlay-soft`, `--shadow`, `--shadow-strong`.

Switching themes is a single class flip on `<html>`. No JavaScript style mutation is needed; the cascade re-resolves every variable reference instantly. The current theme is persisted as `appState.theme`.

### 22.2 UX Principles

- **Dark first.** The default theme matches the PWA manifest's `background_color` (`#141414`) so the standalone install does not flash white on launch.
- **One-keystroke editing.** Plain text nodes are always live in a contenteditable. There is no "edit mode" toggle.
- **Operations are pure functions returning new arrays.** This keeps undo cheap, simplifies grading-without-history, and makes the snapshot diff in `applySnapshot` correct by construction.
- **The vault key never touches the disk.** Every record that crosses the IDB boundary goes through `ctx.encrypt`.
- **Search is a sidecar.** The inverted index is rebuilt on unlock, lives only in memory, and never holds plaintext past lock.

### 22.3 Print Stylesheet

The `@media print` block at [index.html:423-444](index.html#L423-L444) hides every modal, the sidebar, the add bar, the status bar, breadcrumbs, the card pill, the wiki autocomplete, and every overlay. It forces black-on-white colours, expands the editor area to full page width, and renders code blocks with a thin grey border. Used by the Export → Print / PDF tab.

## 23. App State Persistence

`appState` is a single-keyed Dexie table holding plaintext UI preferences and per-vault settings. Known keys:

| Key | Type | Purpose |
|---|---|---|
| `theme` | `'light'` \| `'dark'` | Active theme |
| `autoLockMinutes` | number | Idle-lock duration (0 disables) |
| `autoSnapshotDir-{vaultId}` | FileSystemDirectoryHandle | Auto-snapshot target per vault |
| (UI scratch) | various | Sidebar collapse, last-opened doc per vault, calendar month, etc. |

All other in-flight state is transient:

| State | Lives in | Cleared by |
|---|---|---|
| `state.ctx` (vault key) | RAM | `lockVault()`, auto-lock, tab close |
| `state.nodes`, `state.docs` | RAM | `lockVault()`, vault switch |
| `searchIndex` | RAM | `clearSearchIndex()`, vault switch |
| `undoStack`, `redoStack` | RAM | `clearHistory()`, document switch |
| `cmInstances` | RAM | `destroyCM(id)` on unmount |
| `zoomedId`, `selectedId`, ephemeral collapse | RAM | Document switch / render reset |

Persisting transient state would either leak plaintext into `appState` or require a second encrypted record per vault; the current design accepts the cost of losing per-session UI position when the tab closes.

## 24. Build and Deployment

### 24.1 Dependency Bundle

The only build artifact is `libs/deps.js`, produced by:

```bash
npm run bundle-deps
# expands to:
esbuild deps-entry.mjs --bundle --format=esm --outfile=libs/deps.js \
                       --platform=browser --minify
```

The output is committed to the repository. There is no application transpilation — `index.html` runs as-authored in any modern browser that supports `<script type="module">`, `crypto.subtle`, IndexedDB, and (for code-block editing) the CodeMirror runtime.

### 24.2 Deployment

Deployment is "copy the directory to a static host":

```
index.html
sw.js
manifest.webmanifest
libs/deps.js
icons/icon-192.png
icons/icon-512.png
icons/icon-maskable-512.png
```

Any static host with HTTPS works (HTTPS is required for the service worker, `crypto.subtle`, and the File System Access API). The app also runs from `file://`, with the caveat that the service worker will not register and the File System Access API will not be available.

### 24.3 Cache Busting

A new release is rolled out by:

1. Editing the `CACHE` constant in `sw.js` (e.g. `outline-v3` → `outline-v4`).
2. Uploading the new files.
3. Existing clients pick up the new service worker on the next page load; `activate` deletes every cache except the new one, and `clients.claim()` makes the new SW the active controller immediately.

### 24.4 Known Gaps and Future Work

- **No automated tests.** Every change is verified manually against the acceptance test in §25.6.
- **Flash integration phases.** The phased integration design in [combined_app/plan/](../plan/) (`phase-1` through `phase-8`) tracks the work to deepen the shared card / study surface between flash and outliner. Today the only completed phase visible in the outliner code is the one-way flash-deck importer (§15.3) and the in-tree card extractor / SM-2 grader / study overlay.
- **Cloze card UI surface.** Cloze cards are parsed, scheduled per group, and counted in the due bucket, but the dedicated cloze review UX (per-group grade buttons, group reveal flow) remains an active area of work.
- **IDB quota errors.** Today they propagate as unstyled rejection messages; a friendly "storage full, please prune or back up" surface is not yet wired.
- **Key rotation in UI.** True vault-key rotation requires a snapshot-export → import-as-new-vault round trip; a one-click "rotate vault key" affordance is not exposed.

## 25. Example User Workflows

Five end-to-end traces that exercise every layer.

### 25.1 First-Time Vault Setup

1. User opens the app. `init()` runs, no vault exists, the vault picker `#vault-screen` is shown.
2. User clicks `+ New vault`. The create modal `#vault-new-modal` appears.
3. User enters name + password + confirm. The submit handler validates `length ≥ 8` and `password === confirm`, then calls `initVault(name, password)`.
4. `pickKdfSpec()` returns Argon2id; `deriveKey` derives the password key; `generateKey` creates the vault key; `wrapKey` wraps it; `vaultMeta` and `keyRecords` rows are persisted.
5. `state.ctx` is set; `state.unlocked = true`; the app shell renders; `loadAutoLockSetting` reads the (default) 15-minute timeout and `resetAutoLockTimer` arms the timer; the search index is initialised (empty).

### 25.2 Daily Outlining Session

1. User clicks `📅 Today`. If no daily note exists for today's date, one is created with an ISO-date title.
2. User selects the new document; `state.nodes` is filtered to its nodes (currently empty).
3. User clicks `+ Text` and types text into the contenteditable; on blur (or 300 ms debounce), `applyOp(opInsert ...)` snapshots into the undo stack, writes the encrypted record, and updates the search index.
4. User presses `Tab` to indent a line: `applyOp(opIndent ...)` re-parents the node under its previous sibling with a fresh fractional `order`; only that single row is re-persisted.
5. User pastes an image: the paste handler reads the clipboard blob, encrypts it via `putAsset`, and inserts a new image node referencing the asset.
6. User pastes a code block with three backticks pasted into a text node? — instead they click `+ Code`, which inserts a `kind: 'code'` node; CodeMirror attaches to it; typing is debounced 300 ms before `codeBody` is re-encrypted.

### 25.3 Encrypted Device Transfer

1. **Source device.** User clicks Export, switches to the Encrypted snapshot tab, re-enters the vault password, clicks Export. `exportSnapshot` builds `{ documents, nodes, assets }`, derives a fresh PBKDF2 key, AES-GCM encrypts the JSON, and downloads the resulting envelope.
2. User transfers the `.json` file to the target device (USB, email-to-self, etc).
3. **Target device.** Fresh install; the vault picker is empty. User clicks `Import vault from snapshot…`. The vault-snap modal asks for a vault name, the snapshot password, and the file.
4. `importSnapshot` parses the envelope, decrypts the ciphertext with PBKDF2 derivation, calls `initVault(name, password)` to allocate a brand-new vault with Argon2id, and writes every document, node, and asset re-encrypted under the new vault key.
5. The new vault appears in the picker; selecting and unlocking it shows the original content.

### 25.4 Markdown Round-Trip Into Clean Database

1. User exports a document via Export → Markdown. `exportMarkdown` renders a heading + nested bullets + checkbox markers + fenced code blocks. Images become placeholder references.
2. (Optional.) User opens the `.md` in any editor, makes hand edits, saves.
3. User imports it via Import → Import Markdown. `importMarkdown` walks the depth stack, restoring text / checkbox / code nodes with fresh ids but preserving structure, checkbox state, and code language tags.
4. The result appears as a new document in the current vault. Round-trip is structurally identical for text / checkbox / code; image references appear as text-only placeholders.

### 25.5 Paste Image + HTML Export With Embedded Image

1. User screenshots something to the clipboard.
2. In the editor, user pastes (`Ctrl+V`). The paste handler detects `image/*`, encrypts the bytes, creates an `encryptedAssets` row, inserts an image-kind node.
3. The renderer decrypts the asset, builds a blob URL, and shows the `<img>` inline.
4. User clicks Export → HTML, no password needed. `exportHtml` walks the tree, decrypts each asset, base64-encodes it into a `data:` URI, and renders the document as a self-contained HTML file with rendered KaTeX math.
5. User can open the resulting `.html` in any browser, including offline, with no dependency on the outliner app.

### 25.6 Acceptance Test (Adapted From the Existing Blueprint)

The shipping criterion for the current implementation is the unmodified acceptance test from `local_outliner_blueprint.md`:

```text
Create a document
Add nested bullets
Indent / outdent / move items
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
Structure is preserved (images become placeholders)
```

All steps are exercised by the workflows in §25.1-§25.5. The implementation passes this test in current builds.
