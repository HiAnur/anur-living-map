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
    if (status?.access?.owner) return {label:'Shared online', detail:status.access.linkView ? `This map is stored in Google Cloud. Anyone with the link can ${status.access.linkRole === 'edit' ? 'edit' : 'view'} it, even when this Mac is off.` : 'This map is stored in Google Cloud. Link sharing is off.', online:true};
    return {label:'Shared online', detail:'A cloud copy is available through the shared link, even when this Mac is off.', online:true};
  }
  if (uploading) return {label:'Uploading to cloud…', detail:'Creating the shared copy. Your private chats stay on this Mac.'};
  if (!status) return {label:'Checking sharing status…', detail:'Confirming whether this map has a cloud copy.'};
  const online = !status.configured ? '' : owner ? 'publish it online (your private chats stay here), or ' : 'ask an owner to publish it online, or ';
  return {label:'Only this Mac can open this link', detail:`This map runs on this Mac, so its link opens only here. To share it with someone else, ${online}send it as a file.`, publish:!!status.configured && owner};
}
// What the owner's Share shows of the online link: its owner, whether anyone with the link can view, and
// whether it is on. A copy without a recorded owner keeps its earlier link mode.
/** @param {any} status what /api/cloud answers */
export function onlineAccess(status){
  if (!status?.published) return null;
  const a = status.access;
  if (!a?.owner) return {old:true, mode:status.mode === 'edit' ? 'edit' : status.mode === 'restricted' ? 'restricted' : 'view'};
  return {old:false, owner:a.owner, mode:a.linkRole === 'edit' ? 'edit' : 'view', linkView:!!a.linkView, linkOn:status.mode !== 'restricted'};
}
// The exported picture: up to twice the view's size, within a browser canvas's limits (8192 px a side, 16 million
// pixels in all).
/** @param {number} width @param {number} height */
export function imageExportSize(width, height){
  const scale = Math.min(2, 8192 / width, 8192 / height, Math.sqrt(16000000 / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}
