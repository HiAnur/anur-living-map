// What the Share panel says about where a map is stored, and how big an exported image is drawn.
// A page module: see page-modules.js.

// Storage and link access are separate: revoking a link does not delete the hosted copy. A map kept only on this
// Mac says so plainly, since its link is a localhost address no one else can open, and names the ways that do reach
// someone else: online, when this Mac is set up for it, or as a file. `publish`: offer Publish online here.
/** @param {any} status @param {{ cloud?: boolean, file?: boolean, uploading?: boolean, owner?: boolean }} [where] */
export function sharingLocation(status, {cloud = false, file = false, uploading = false, owner = false} = {}){
  if (file) return {label:'Downloaded file', detail:'You are viewing a saved file. Its original map may also be shared online.'};
  if (cloud || status?.published){
    if (status?.mode === 'restricted') return {label:'In cloud · link off', detail:'Link access is off. A cloud copy of this map is still stored.', online:true};
    if (status?.access?.owner) return {label:'Shared online', detail:status.access.linkView ? 'Anyone with the link can view it, even when this Mac is off. Only the people you add can edit it.' : 'Only the people you add can open its link, even when this Mac is off.', online:true};
    return {label:'Shared online', detail:'A cloud copy is available through the shared link, even when this Mac is off.', online:true};
  }
  if (uploading) return {label:'Uploading to cloud…', detail:'Creating the shared copy. Your private chats stay on this Mac.'};
  if (!status) return {label:'Checking sharing status…', detail:'Confirming whether this map has a cloud copy.'};
  const online = !status.configured ? '' : owner ? 'publish it online (your private chats stay here), or ' : 'ask an owner to publish it online, or ';
  return {label:'Only this Mac can open this link', detail:`This map runs on this Mac, so its link opens only here. To share it with someone else, ${online}send it as a file.`, publish:!!status.configured && owner};
}
// Who may open the online copy, as the owner's Share lists it: none before it is published; `old` for a copy
// published before Google sign-in, which anyone with its link may open as its mode says; else its owner, the
// people by address (sorted, each with Can view or Can edit), whether anyone with the link can view, and whether
// the link is on at all.
/** @param {any} status what /api/cloud answers */
export function onlineAccess(status){
  if (!status?.published) return null;
  const a = status.access;
  if (!a?.owner) return {old:true, mode:status.mode === 'edit' ? 'edit' : status.mode === 'restricted' ? 'restricted' : 'view'};
  const people = Object.entries(a.people || {}).filter(([, role]) => role === 'view' || role === 'edit').sort(([x], [y]) => x.localeCompare(y)).map(([email, role]) => ({email, role}));
  return {old:false, owner:a.owner, people, linkView:!!a.linkView, linkOn:status.mode !== 'restricted'};
}
// An address as typed into Share, lowercased, or '' when it is not a whole address. The cloud checks it again.
/** @param {unknown} typed */
export function inviteEmail(typed){
  const email = String(typed || '').trim().toLowerCase();
  return email.length <= 254 && /^[^\s@<>"'`]+@[^\s@<>"'`.]+(\.[^\s@<>"'`.]+)+$/.test(email) ? email : '';
}
// The exported picture: up to twice the view's size, within a browser canvas's limits (8192 px a side, 16 million
// pixels in all).
/** @param {number} width @param {number} height */
export function imageExportSize(width, height){
  const scale = Math.min(2, 8192 / width, 8192 / height, Math.sqrt(16000000 / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}
