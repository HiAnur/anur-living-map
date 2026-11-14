# Shared maps on GCP

A separate Cloud Run service stores shared maps in the existing `living-map-login`
project's default Firestore database. Local servers stay on loopback. Cloud sharing
never opens a tunnel or requires the Mac to stay awake.

Share → Publish online uploads the selected map. Publishing needs Google: the
local server sends the Google ID token from its owner's latest sign-in
(`x-google-id-token`), and the cloud checks it against Google's public keys
(`google-id.js`: signed by Google, meant for the login service's client
`GOOGLE_CLIENT_ID`, unexpired, address verified), so it needs no Google secret. The
copy records that account as its `owner`, with `people` (address → `view` or
`edit`, lowercased, at most 100) and `linkView` (off). Only the owner's Mac, with
its sharing key, its owner key and a fresh token for the owner's address, changes
`people`, `linkView` or the link, or deletes the copy (`/m/<id>/api/sharing`,
`/m/<id>/api/delete`); the owner key alone keeps syncing the map.

A visitor needs the link and, unless `linkView` is on, a Google sign-in on the
cloud itself: `/auth/google` sends them through the login service (which must list
this cloud's origin in `RETURN_ORIGINS`) and `/auth/done` trades the one-time code
for an ID token, checks it, and sets `lm_cloud_session` (HttpOnly, Secure,
SameSite=Lax, 30 days, signed with a key derived from `PUBLISH_KEY`; the cloud keeps
no session store). A listed address gets its role and edits under its Google name;
any other sees a page asking its owner for access, and an API answer that says the
same, with nothing of the map. Access is checked on every request, so a removed
address is out at once. Visitors are never sent the people list or anyone's
address: only the names of who has the map open, kept in memory for 20 seconds.
“Turn off link” keeps everyone out, listed or not; a new link after revocation
uses a new secret.

A copy published before Google sign-in has no owner and works as before (its link
gives view or edit) until its Mac publishes or changes its sharing with a token,
which claims it. Boxes, lines, descriptions and comments sync both ways while the local
server runs. Independent edits merge; overlapping edits stop synchronization with
an error, keeping both copies. The cloud map remains editable while the Mac is off.
Local changes are retried when the connection returns.

In the local Share dialog, owners can choose **Delete online copy** and confirm to
remove the hosted map and disable its link. The local map stays on the Mac, and
synchronization stops. Sharing again asks to upload a new copy with a new link.
A failed delete keeps the sharing details so the owner can retry.

Private chats, pending proposals, memory, local paths, sign-in records and local
member names are excluded. Cloud visitors use their listed access (or an old copy's
link permissions) and separate undo histories. Claude runs only locally. Cloud history is limited to the most
recent 20 undo steps per visitor (20 visitors); local History remains on the Mac.
Cloud maps currently support up to 3,000 boxes per graph and a compressed document
of 700 KB. Text is preserved in storage and escaped when displayed; style fields
remain restricted. Links are bearer credentials: anyone receiving one has its
selected permission. Do not place them in public issues or deployment logs.

## Local setup

The private file `cloud.json` in the team map's data folder (`~/.anur-living-map`, see `data-dir.js`; mode 0600) contains `url` (the service's
HTTPS origin) and `publishKey` (64 random hex characters). `LIVING_MAP_CLOUD_CONFIG`
can select another file. Per-map `cloud.json` keeps its private owner key and last
synchronized graph beside `state.json`; it must never be committed or shared.
Only local map owners can publish, change permissions, or receive sharing status.
`cloud.json` also keeps the copy's `access` as the cloud last answered, for Share.

## Deployment

Use `prepare.mjs` to create the build context. It copies the live server's code
(every `.js` beside it and under `agents/`) and the page, and excludes maps, local
configuration, tests and private files; `prepare.test.js` checks the cloud server
loads from it alone. Deploy that context with Cloud Run source
builds. Use a dedicated service account with `roles/datastore.user` and access only
to the `living-map-publish-key` Secret Manager secret. Set `PROJECT`, `PUBLIC_URL`,
the secret-backed `PUBLISH_KEY`, and `GOOGLE_CLIENT_ID` (the login service's OAuth
client ID, which is public). `LOGIN_URL` points at another login service. The
service fetches Google's public keys from `www.googleapis.com` and calls the login
service's `/exchange`; nothing else leaves it. The public service's application routes enforce
link permissions; IAM public invocation alone never grants access to a map.

Use request billing, minimum instances 0, maximum instances 1, 256 MiB memory,
1 CPU, concurrency 20 and a 60-second timeout. Map pages poll with short requests
rather than holding billable streaming connections open. Firestore writes use
update-time preconditions, so concurrent requests and overlapping revisions cannot
silently overwrite one another. A successful response follows durable storage.
The cloud service uses no local disk for map storage.

Cloud Run, builds, image storage, network transfer, Secret Manager and Firestore
may incur charges beyond their free allowances. Maximum instances is not a spending
cap. Check the account's existing usage before estimating the added bill.
