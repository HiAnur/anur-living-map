# Living Map login

Google sign-in for Living Map: anyone with a Google account gets in. Each map still runs on its own Mac; only signing in happens here.

- **Where:** Cloud Run service `living-map-login` in the GCP project `living-map-login` (us-west1), at
  https://living-map-login-572969880390.us-west1.run.app. The list is in that project's Firestore.
- **Google sign-in:** the project's own client, "Living Map login". Its secret is in Secret Manager
  (`google-client-secret`) and in `~/.private_keys/living-map-login.env`. The app is in Google's testing
  mode, so each Google address must also be a test user: Cloud Console ▸ Google Auth Platform ▸ Audience.
  Sharing online by email needs it published (Audience ▸ Publish app), asking only for `openid`, `email` and
  `profile`.
- **The list** only renames: an address on it signs in as the name kept there instead of its Google name; a name and password is for someone with no Google account (from any Mac signed in to gcloud):

```bash
node login/server.js add <email> <name>              # that Google address signs in as this name
printf '%s' '<password>' | node login/server.js password <name>   # someone with no Google account
node login/server.js list
node login/server.js remove <email or name>
```

- **Online copies:** a map's online copy (`../cloud/`) signs its visitors in here too. `RETURN_ORIGINS` lists the
  https origins, besides a Mac's localhost, that `/start` may send a browser back to (`<origin>/auth/done`),
  comma-separated; any other return address is refused.
- **ID tokens:** `/exchange` also answers with Google's ID token (`id_token`) from the sign-in. A Mac hands it to
  the cloud as proof of who publishes; the cloud checks it with Google's public keys. It is sealed with the rest of
  the one-time code, and never logged; the service logs who signed in by name only.
- **Deploy:** `gcloud run deploy living-map-login --source login --region us-west1 --project living-map-login`
