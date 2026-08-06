# Project Notes

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
