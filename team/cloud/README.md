# Shared maps on GCP

A separate Cloud Run service stores shared maps in the existing `living-map-login`
project's default Firestore database. Local servers stay on loopback. Cloud sharing
never opens a tunnel or requires the Mac to stay awake.

Share → Copy link uploads the selected map. “Anyone with the link can” controls
view or edit; “Turn off link” revokes it. A new link after revocation uses a new
secret. Boxes, lines, descriptions and comments sync both ways while the local
server runs. Independent edits merge; overlapping edits stop synchronization with
an error, keeping both copies. The cloud map remains editable while the Mac is off.
Local changes are retried when the connection returns.

In the local Share dialog, owners can choose **Delete online copy** and confirm to
remove the hosted map and disable its link. The local map stays on the Mac, and
synchronization stops. Sharing again asks to upload a new copy with a new link.
A failed delete keeps the sharing details so the owner can retry.

Private chats, pending proposals, memory, local paths, sign-in records and local
member names are excluded. Cloud visitors use link permissions and separate browser
undo histories. Claude runs only locally. Cloud history is limited to the most
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

## Deployment

Use `prepare.mjs` to create the build context. It copies the live server's code
(every `.js` beside it and under `agents/`) and the page, and excludes maps, local
configuration, tests and private files; `prepare.test.js` checks the cloud server
loads from it alone. Deploy that context with Cloud Run source
builds. Use a dedicated service account with `roles/datastore.user` and access only
to the `living-map-publish-key` Secret Manager secret. Set `PROJECT`, `PUBLIC_URL`
and the secret-backed `PUBLISH_KEY`. The public service's application routes enforce
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
