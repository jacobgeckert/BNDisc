# Project Notes

## Deployment & cache busting

- `index.html` has a **build stamp** under the Admin Dashboard heading
  (e.g. `build v2026.10.30.1`). Bump it on every visible change — it's the
  quick way to confirm the new HTML actually deployed to GitHub Pages. If
  the stamp is old, the browser has a stale `index.html`: hard-refresh
  (Ctrl/Cmd+Shift+R); the `?v=` params on script tags only bust JS cache,
  not the HTML doc itself.
- When editing JS files, bump their `?v=` numbers in `index.html` AND in
  any cross-imports (e.g. theme.js imports admin.js/loginLeague.js/vote.js).

## Firestore Security Rules — required for "first time setup" login

The League Central and Admin login pages let a user who is already on the
Firestore allow-list (`admins` / `league_admins` collections) create their
own Firebase Auth password on first login (see `js/authSetup.js`).

Because this check happens **before** the user is signed in, your Firestore
Security Rules must allow an unauthenticated `get` (single document read by
known ID) on those two collections. Do NOT allow `list` publicly — that
would let anyone enumerate every admin's email address.

Add something like this to your rules (merge with your existing rules,
don't replace them wholesale):

```
match /admins/{email} {
  allow get: if true;
  allow list, write: if false; // keep write/list restricted to your existing admin logic
}

match /league_admins/{email} {
  allow get: if true;
  allow list, write: if false;
}
```

If you see an alert like `"someone@example.com" is not an authorized
account` during first-time setup even though the document clearly exists in
the Firestore console, this is almost always the cause — check the browser
console for a `permission-denied` error to confirm.

## Free Round Allotments — `free_rounds` collection

The Admin Dashboard's "Free Round Allotments" card writes docs keyed by
player slug:

```
free_rounds/{playerSlug} = {
  name,
  seasons: { "2026Spring": { allotted, used } },
  ace: { allotted, used }          // ace-pot credits: running balance,
                                   // not seasonal, opt-in only at check-in
}
```

League Central (`js/loginLeague.js`) lists the whole collection at check-in
and `increment()`s `seasons.{year}{season}.used` / `ace.used` when a round
is finalized, so **league directors need read + write**. Allotments are
managed only by admins; if your rules distinguish roles, restrict full-doc
writes to admins but still let league admins update `seasons.*.used` and
`ace.used`. A simple baseline:

```
match /free_rounds/{playerId} {
  allow read, write: if request.auth != null;
}
```

## Elections & Voting — `elections` / `ballots` / `votes` collections

Board elections (`#vote` page, "Elections & Voting" admin card) use three
collections:

```
elections/{id}      = { title, positions: [{title, maxChoices, candidates[]}],
                        open, navVisible, closesAt (Timestamp), createdAt, createdBy }
ballots/{token}     = { electionId, email, used, usedAt, createdAt }
                      // token = 128-bit url-safe random; the doc ID is the credential
votes/{sha256(token)} = { electionId, selections, submittedAt }
                      // doc ID is a one-way hash — a vote can't be tied to an email
```

The token's unguessability is what makes unauthenticated `get` safe on
`ballots` — never allow `list` publicly (emails would be enumerable). Votes
are create-only (`update: if false` makes double-voting structurally
impossible); only admins can `delete` them for cleanup. `request.time`
enforces the close date so a client clock can't reopen voting.

The full ruleset — including the three `match` blocks for these collections —
is versioned in `firestore.rules` at the repo root; paste its contents into
the Firebase console when deploying.

Caveat: `request.auth.token.email` may be mixed-case for Google sign-in;
the `isClubAdmin()` `.lower()` call assumes `admins` doc IDs are stored
lowercase (they are, per the existing auth code). If admin checks start
failing, verify the doc ID casing matches `email.lower()`.

## Gmail sender — OAuth setup for in-dashboard email blasts

The Elections card can send ballot links straight from an admin's Gmail via
the Gmail API (`gmail.send` scope, GIS token client — no backend). The OAuth
client can live in ANY GCP project — it does not need to be the Firebase
project, and it does not need to be owned by the sending account. The sender
is whichever Google account authorizes in the Connect popup (must be a listed
test user). To send as the club email from a personal-account project, just
add the club email as a test user; or do the whole setup signed in as the
club account for cleaner ownership.

One-time setup in Google Cloud Console (any project, e.g. `bndisc-4de3e` or
a club-owned project):

1. APIs & Services → Library → enable **Gmail API**.
2. OAuth consent screen → External → fill in app name + support email →
   add the scope `.../auth/gmail.send` → add the sending Gmail(s) — e.g. the
   club email — as **test users** (the app stays unverified, which is fine
   for self-use — you'll get the "Google hasn't verified this app" warning
   and click Advanced → Continue).
3. Credentials → Create Credentials → **OAuth client ID** → Web application →
   Authorized JavaScript origins: `https://bndisc.com` (plus
   `http://localhost:8317` or whatever local port you test on).
4. Paste the client ID (`….apps.googleusercontent.com`) into the Elections
   card's "Gmail sender setup" box — it's a public identifier, not a secret.
   Both setup fields persist to `settings/gmail` in Firestore (admin-only
   `read, write` rule — included in `firestore.rules`), so they're entered
   once and shared across devices and admins; localStorage just mirrors
   them for the current browser.

Notes: access tokens last ~1h (the code re-requests silently; occasionally
it'll re-prompt). Consumer Gmail caps around ~500 sent emails/day. Ballot
docs get a `sentAt` stamp after a successful send — that's why the
`ballots` update rule is `isClubAdmin() || <used-flip>` rather than just
the used-flip.

