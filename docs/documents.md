# Document store

Receipts, supplier invoices, courier bills, bank slips, statements. One uploaded
file per row, with the facts a human needs to find it again and links to whatever
it is evidence for.

Admin UI at `/admin/documents`, plus a **Documents** card on an order's *Order
Complete* tab and a paperclip on every row of *Finance → Expenses*.

---

## The three decisions that shape everything

### 1. The file is not public

Product images live in `uploads/`, which `server.ts` registers with
`@fastify/static` and serves to the whole internet — it even loosens
`Cross-Origin-Resource-Policy` so mail clients can fetch thumbnails. Correct for
a product photo.

A receipt is a different thing: it carries a customer's name, phone and address,
or our own bank details. **A UUID filename is obscurity, not access control** —
once that URL reaches a browser history, a forwarded message or a proxy log, it
is readable by anyone, forever.

So documents live in `backend/documents/`, which nothing serves statically, and
the only way to read one is `GET /api/v1/admin/documents/:id/file` behind the
admin JWT. Keeping them in a separate tree also means a future change that widens
the static mount cannot expose them by accident.

A consequence worth stating, because it looks like an oversight otherwise:
**`<img src="/api/…/file">` cannot work.** The admin token lives in
localStorage, not a cookie, so the browser's own request would arrive
unauthenticated. Every preview and download fetches the bytes with the header
attached and renders the resulting object URL — see `adminFetchDocumentBlob` in
`frontend/src/lib/api.ts`. The caller owns that URL and must revoke it.

### 2. The file is stored exactly as uploaded

The product image endpoint re-encodes to WebP and downscales to 1600px. Right for
a photo, wrong for a document you may have to produce to an accountant or a bank.
Bytes in, bytes out — no re-encode, no resize.

Type is decided from the file's **magic bytes**, never the client-declared MIME:
PDF, JPEG, PNG, WebP, AVIF, HEIC. Nothing else. That is not a hedge about effort —
it is what lets the read route serve a document inline without worrying that its
bytes are secretly HTML or SVG that would execute against the admin's own
session. A plain-text format like CSV cannot be sniffed at all, so allowing one
would mean allowing arbitrary text and giving up that guarantee; if bank-statement
CSVs are wanted later they should be attachment-only and never served inline.

### 3. Links are many-to-many, and optional

One supplier invoice covers stock that ships across twenty orders. One order can
have an invoice, a courier slip and a payment slip. And a document that links to
nothing — an SSM certificate, a bank statement — is perfectly valid and must not
be forced to attach to something it has no relationship with.

`DocumentLink` is a single table with two nullable targets rather than two join
tables: "what is this filed against" is then one query and one UI list, and a
third kind of target later is a column, not a table. **Exactly one target must be
set**, enforced by a CHECK constraint in the migration because Prisma's schema
language cannot express it:

```sql
CHECK (("orderId" IS NOT NULL)::int + ("expenseId" IS NOT NULL)::int = 1)
```

Without it a link row could point at nothing (invisible everywhere, undeletable
from the UI) or at both (counted twice in both places).

---

## Data model

```
Document        title, description, kind, occurredAt, amount?,
                filename, originalName, mimeType, sizeBytes
DocumentLink    documentId + exactly one of (orderId | expenseId)
```

- **`kind`** is free text with the form suggesting kinds already in use — the same
  pattern as expense categories. A fixed enum would need a migration the first
  time a new kind of paperwork shows up, which is a certainty.
- **`occurredAt`** is the date *on the document*, not the upload time. August
  receipts get filed in September, and the date printed on the paper is what
  anyone will search by. Same split as `CompanyExpense.occurredAt` / `createdAt`.
- **`amount`** is optional cents. Where it exists it makes the cabinet checkable
  rather than merely searchable — a RM5,000 invoice with no expense recorded
  against it is a question worth being able to ask.
- **`filename`** is `<uuid>.<ext>`, always generated. `originalName` is what the
  user called it, used for display and downloads and **never** to build a path.

This replaced `CompanyExpense.receiptUrl`, which allowed exactly one file per
expense, was wired to no UI (nothing ever wrote it), and pointed into the
world-readable `/uploads` mount. It was empty in every environment when dropped.

---

## API

All routes require the admin JWT, **including the file stream**.

| | |
|---|---|
| `GET /api/v1/admin/documents` | list; `search`, `kind`, `orderId`, `expenseId`, `unlinked`, `from`, `to`, `page`, `limit` (default 50) |
| `POST /api/v1/admin/documents` | multipart upload: the file plus metadata and initial links |
| `GET /api/v1/admin/documents/:id` | one document with its links |
| `PATCH /api/v1/admin/documents/:id` | edit title/description/kind/date/amount |
| `PUT /api/v1/admin/documents/:id/links` | **replace** the whole link set |
| `DELETE /api/v1/admin/documents/:id` | removes the row and the bytes |
| `GET /api/v1/admin/documents/:id/file` | the bytes; `?download=1` forces a save |

`search` matches title, description, uploaded filename **and order number**, so
pasting `ASC2608/0022` finds the paperwork filed against it.

Links are replace-all rather than per-row CRUD: they are only meaningful as a set
("this invoice covers these four orders"), and a partial edit is not a state
worth being able to persist.

### Upload notes

- Fields may appear **before or after** the file part. The endpoint walks
  `request.parts()` rather than using `request.file()`, whose `.fields` only ever
  contains what arrived before the file — which made the endpoint quietly
  dependent on client field order.
- **10 MB limit**, and that number is not arbitrary: it matches
  `client_max_body_size` on ascendpeptides.my. A larger figure in the app would be
  a lie, because nginx rejects the request with its own 413 before Fastify sees
  it and the friendly error never fires. **Raising it means raising nginx in the
  same change — both numbers, or neither.**
- A failed upload never leaves bytes behind; the temp file is removed on every
  rejection path, including a database failure after the file has landed.

### Serving

`Content-Disposition` is built per RFC 6266 with **both** an ASCII `filename` and
a percent-encoded `filename*`. A header value in Node must be latin1; anything
outside it throws `ERR_INVALID_CHAR` and the response 500s. Uploaded filenames
are not ASCII in practice — `資料 invoice.pdf`, or anything a Mac names with a
curly quote — so the naive form broke downloads for exactly the files most likely
to arrive here.

Also sent: `X-Content-Type-Options: nosniff`, a locked-down CSP, and
`Cache-Control: private, no-store`.

---

## The agent

Five tools in their own routed domain (`documents`): `list_documents`,
`get_document`, `update_document`, `file_document`, `delete_document`.

**The agent never hands out a file.** It can say a document exists, what it is,
when it is dated, what it is worth and what it is filed against — everything
needed to answer "do we have the receipt for that order?" — and cannot emit the
stored filename, a path, or a URL, because none of them enter its context. The
`shape()` function in `documents.tools.ts` is that boundary. Opening the file is
a thing a human does in the admin.

That is a negative, and a negative stops holding the moment someone adds a field
to `shape()`. So it is asserted:

```bash
npm run test:agent:documents
```

`file_document` is marked **destructive** even though it only rewrites links: it
is a replace-all with no undo, so filing a courier invoice against one order
silently detaches it from the other nineteen it covered, and nobody can
reconstruct that list from memory. Marking it destructive also has a practical
effect — `summarize` only ever runs for destructive tools, so without it the
operator would be told nothing before the links were replaced.

Routing note: `receipt` / `resit` / `invoice` are keywords in **both** the
`orders` and `documents` domains. A message about either genuinely wants both,
and `routeDomains` returns every domain a message matches.

---

## Storage and backups

Files live at `backend/documents/` — resolved from `process.cwd()`, which for
`ascend-api` is `/home/ubuntu/ascend/backend`, the same place `uploads/` sits. The
deploy only ever pulls and restarts, so the directory survives untouched.

**There is no backup of this directory**, by explicit decision. A deleted document
is gone. `delete_document`'s confirmation says so, and so does the UI prompt.

`.gitignore` anchors the rule as `/backend/documents/` and **not** a bare
`documents/` — the bare form matches at every depth and silently excluded
`frontend/src/app/admin/documents/`, the entire UI for this feature, from being
committed at all.
