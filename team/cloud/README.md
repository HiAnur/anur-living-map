# Shared maps on GCP

A separate Cloud Run service stores shared maps in the existing `living-map-login`
project's default Firestore database. Local servers stay on loopback. Cloud sharing
never opens a tunnel or requires the Mac to stay awake.

Share → Publish online uploads the selected map. Publishing needs Google: the
local server sends the Google ID token from its owner's latest sign-in
(`x-living-map-google-id-token`), and the cloud checks it against Google's public keys
(`google-id.js`: signed by Google, meant for the login service's client
`GOOGLE_CLIENT_ID`, unexpired, address verified), so it needs no Google secret. The
copy records that account as its `owner`. The publishing request sets `linkView: true`
after the owner confirms the upload. Its `linkRole` selects `view` or `edit` for people holding the link. A recipient
opens the link directly, without signing in. Share offers **Can view**, **Can edit**, and **Turn off link**. Only the owner's Mac, with its sharing key, owner key and a fresh Google
token, changes sharing or deletes the copy; the owner key alone keeps syncing.

An owner record also stores earlier email grants in `people`. The cloud checks
those grants for existing maps and accepts their API representation, while the Share
dialog provides link sharing. A publishing request that omits `linkView` creates
a restricted copy. Repeating a confirmed publication with `linkView: true`
applies that link setting only for the verified owner. Sharing status from the
cloud tells the Mac which access setting was stored.

The cloud's Google sign-in (`/auth/google` and `/auth/done`) remains available
for the owner and people with earlier edit access. It checks the token and sets
`lm_cloud_session` (HttpOnly, Secure, SameSite=Lax, 30 days, signed with a key
derived from `PUBLISH_KEY`). Visitors receive only the names of who has the map
open. Anonymous visitors use guest names. The owner’s Mac receives the same live
presence list, kept in memory for 20 seconds and excluded from saved map data. **Turn off link** keeps everyone out; turning it on after revocation uses
a new secret.

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
can select another file. An explicitly cloud-enabled preview can set `LIVING_MAP_CLOUD_COPIES` to a private directory of its own to keep its published copies separate from the source maps. Per-map `cloud.json` keeps its private owner key and last
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
