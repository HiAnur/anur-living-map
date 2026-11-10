// What the Share panel says about where a map is stored, and how big an exported image is drawn.
// A page module: see page-modules.js.

// Storage and link access are separate: revoking a link does not delete the hosted copy.
/** @param {any} status @param {{ cloud?: boolean, file?: boolean, uploading?: boolean }} [where] */
export function sharingLocation(status, {cloud = false, file = false, uploading = false} = {}){
  if (file) return {label:'Downloaded file', detail:'You are viewing a saved file. Its original map may also be shared online.'};
  if (cloud || status?.published){
    if (status?.mode === 'restricted') return {label:'In cloud · link off', detail:'Link access is off. A cloud copy of this map is still stored.', online:true};
    return {label:'Shared online', detail:'A cloud copy is available through the shared link, even when this Mac is off.', online:true};
  }
  if (uploading) return {label:'Uploading to cloud…', detail:'Creating the shared copy. Your private chats stay on this Mac.'};
  if (!status) return {label:'Checking sharing status…', detail:'Confirming whether this map has a cloud copy.'};
  return {label:'Local only', detail:status.configured ? 'Stored on this Mac. Sharing a link uploads a cloud copy; your private chats stay here.' : 'Stored on this Mac. Cloud sharing is not set up.'};
}
// The exported picture: up to twice the view's size, within a browser canvas's limits (8192 px a side, 16 million
// pixels in all).
/** @param {number} width @param {number} height */
export function imageExportSize(width, height){
  const scale = Math.min(2, 8192 / width, 8192 / height, Math.sqrt(16000000 / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}
