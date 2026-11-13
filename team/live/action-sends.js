// What an Action run may send, checked by code on each tool call before it runs, from the call's own input: never
// from the tool's name alone, and never from what the model says it will do. Every agent's run hands its calls
// here (agents/claude-code/run.js through its PreToolUse hook, agents/pi/extension.js through its tool_call
// listener), so this file imports nothing and may be loaded on its own.

// Words in a tool's own name that mean it hands something to other people: a backup to the list of known tools
// below, which can only add a send
const SENDS = new Set(['send', 'post', 'reply', 'forward', 'publish', 'comment', 'respond', 'broadcast', 'notify', 'invite', 'share']);
// A send of mail, as opposed to a chat message or a comment
const MAIL = /mail|outlook/i;
// The input fields a new message may carry. Anything else (a draft to send as it is, a message to reply to or
// forward, an HTML body, attachments, a signature) was not reviewed, so a call carrying it is refused.
const MESSAGE_FIELDS = new Set(['to', 'cc', 'bcc', 'subject', 'body']);
const QUIET = (/** @type {unknown} */ v) => v === undefined || v === null || v === false || v === '' || (Array.isArray(v) && !v.length);

/** @typedef {'reads' | 'changes' | 'sends' | 'mails'} ToolUse */
/** @param {string} names space-separated tool names @param {ToolUse} use @returns {[string, ToolUse][]} */
const each = (names, use) => names.split(/\s+/).filter(Boolean).map((n) => [n, use]);
// The connector and MCP tools the map knows, by the server they come from (matched in its name, as Claude Code
// and Pi call it mcp__<server>__<tool>): which only read, which change things but reach no one, which send, post
// or reply to people, and which of those send mail. A tool not here is unknown: a run nobody started refuses it,
// and a run someone started may use it, noted as unknown in what the run did.
const KNOWN = /** @type {[RegExp, Map<string, ToolUse>][]} */ ([
  [/gmail/i, new Map([
    ...each('search_threads get_thread get_message list_labels list_drafts get_draft download_gmail_attachment', 'reads'),
    ...each(`create_draft update_draft delete_draft create_label update_label delete_label label_message label_thread unlabel_message
      unlabel_thread update_message_labels trash_message trash_thread untrash_message untrash_thread mark_message_spam mark_thread_spam
      unmark_message_spam unmark_thread_spam apply_sensitive_message_label apply_sensitive_thread_label`, 'changes'),
    ...each('send_message send_email reply forward', 'mails'),
  ])],
  [/slack/i, new Map([
    ...each(`slack_read_channel slack_read_thread slack_read_canvas slack_read_file slack_read_list slack_read_user_profile
      slack_search_channels slack_search_public slack_search_public_and_private slack_search_users slack_search_emojis
      slack_list_channel_members slack_list_user_channels slack_get_reactions read_channel read_thread search_public`, 'reads'),
    ...each('slack_create_canvas slack_update_canvas slack_create_list slack_update_list slack_add_list_record slack_update_list_record slack_get_file_upload_url slack_send_message_draft', 'changes'),
    ...each('slack_send_message slack_schedule_message slack_create_conversation slack_add_reaction slack_complete_file_upload send_message', 'sends'),
  ])],
  [/microsoft|365|outlook|office/i, new Map([
    ...each(`outlook_email_search outlook_calendar_search outlook_find_available_time find_meeting_availability read_resource search_people
      get_me get_granted_scopes chat_message_search sharepoint_search sharepoint_folder_search teams_list_channels teams_list_chats
      teams_list_teams teams_list_channel_messages`, 'reads'),
    ...each(`outlook_create_draft outlook_update_draft outlook_delete_draft outlook_create_reply_draft outlook_create_reply_all_draft
      outlook_modify_labels outlook_modify_thread_labels outlook_batch_modify_labels outlook_batch_delete_messages outlook_trash_thread
      outlook_untrash_thread outlook_create_label outlook_update_label outlook_delete_label outlook_create_filter outlook_delete_filter
      sharepoint_copy_item sharepoint_create_folder sharepoint_delete_item sharepoint_move_item sharepoint_rename_item
      sharepoint_update_file sharepoint_upload_file`, 'changes'),
    ...each(`outlook_create_event outlook_update_event outlook_delete_event outlook_respond_to_event outlook_set_vacation
      teams_send_channel_message teams_send_chat_message teams_reply_channel_message teams_create_chat`, 'sends'),
    ...each('outlook_send_mail outlook_send_draft outlook_forward_mail', 'mails'),
  ])],
  [/github/i, new Map([
    ...each(`get_me get_issue get_issue_comments list_issues search_issues get_pull_request get_pull_request_files
      get_pull_request_comments get_pull_request_reviews get_pull_request_status get_pull_request_diff list_pull_requests
      search_pull_requests get_file_contents search_code search_repositories list_commits get_commit list_branches`, 'reads'),
    ...each('create_branch create_or_update_file push_files create_pending_pull_request_review delete_pending_pull_request_review', 'changes'),
    ...each(`add_issue_comment create_issue update_issue create_pull_request update_pull_request merge_pull_request
      create_pull_request_review submit_pending_pull_request_review add_comment_to_pending_review
      add_pull_request_review_comment_to_pending_review request_copilot_review`, 'sends'),
  ])],
  [/linear/i, new Map([
    ...each(`get_issue list_issues list_comments get_document list_documents get_project list_projects get_team list_teams get_user
      list_users whoami get_issue_status list_issue_statuses list_issue_labels list_cycles get_milestone list_milestones
      search_documentation get_diff list_diffs get_diff_threads`, 'reads'),
    ...each('save_document save_project save_milestone save_issue_label create_issue_label delete_attachment create_attachment', 'changes'),
    ...each('save_comment save_issue share_issue save_status_update save_diff_comment submit_diff_review merge_diff', 'sends'),
  ])],
  [/notion/i, new Map([
    ...each(`notion-search notion-fetch notion-get-comments notion-get-users notion-get-teams notion-get-self notion-query-data-sources
      notion-list-recent-pages notion-list-shared-pages notion-list-private-pages notion-query-meeting-notes`, 'reads'),
    ...each('notion-create-pages notion-update-page notion-move-pages notion-duplicate-page notion-create-database notion-update-data-source', 'changes'),
    ...each('notion-create-comment notion-update-comment notion-send-message-to-session', 'sends'),
  ])],
  [/drive/i, new Map([
    ...each('search_files read_file_content download_file_content get_file_metadata get_file_permissions list_recent_files list_file_revisions list_shared_drives get_shared_drive_metadata', 'reads'),
    ...each('create_file update_file copy_file trash_file', 'changes'),
    ...each('share_file', 'sends'),
  ])],
  // the team map's own servers, which read maps or draw on this one
  [/map/i, new Map([
    ...each('list_maps load_map living_map_read living_map_load living_map_catalog', 'reads'),
    ...each('living_map_change propose_change', 'changes'),
  ])],
]);

/** The words of a tool's own name: `mcp__server__send_message` gives send and message. @param {string} tool */
const words = (tool) => String(tool).split('__').at(-1)?.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z]+/).filter(Boolean) || [];
/** Whether a tool's own name says it sends, posts or replies. A draft that is only saved is not a send. @param {string} tool */
function namedSend(tool) {
  const w = words(tool);
  if (w.includes('draft') && !w.includes('send')) return false;
  return w.some((x) => SENDS.has(x));
}

/**
 * What a tool does, as far as the map knows: from the list above, with its name as a backup that can only make it
 * a send, never take a send off the list. null for a tool the map does not know (an agent's own built-in tools are
 * the agent's to say, by its `reach`).
 * @param {string} tool @returns {ToolUse | null}
 */
export function toolUse(tool) {
  const [, server = '', name = ''] = /^mcp__(.+?)__(.+)$/.exec(String(tool)) || [];
  const listed = KNOWN.find(([re, tools]) => re.test(server) && tools.has(name))?.[1].get(name) ?? null;
  if (listed === 'sends' || listed === 'mails') return listed;
  if (namedSend(tool)) return MAIL.test(String(tool)) ? 'mails' : 'sends';
  return listed;
}
/** Whether a tool sends, posts or replies to other people. @param {string} tool */
export const sendsTool = (tool) => { const use = toolUse(tool); return use === 'sends' || use === 'mails'; };
/** Whether a tool sends mail. @param {string} tool */
export const mailTool = (tool) => toolUse(tool) === 'mails';

/** The addresses in a recipient field: a list, or one string split at commas or semicolons, each `Name <addr>` read as addr. @param {unknown} field @returns {string[]} */
export function addresses(field) {
  const list = Array.isArray(field) ? field : typeof field === 'string' ? field.split(/[,;]/) : [];
  return list.map((a) => (typeof a === 'string' ? a : typeof a?.address === 'string' ? a.address : typeof a?.email === 'string' ? a.email : ''))
    .map((a) => (/<([^<>]+)>\s*$/.exec(a)?.[1] ?? a).trim().toLowerCase()).filter(Boolean);
}
/** Text compared without the whitespace a mail tool may add or drop. @param {unknown} s */
const same = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : null);

/**
 * Why a send call is not the reviewed message, or '' when it is: to the one reviewed recipient, no one copied,
 * the reviewed subject and body, and nothing else.
 * @param {{ to: string, subject: string, body: string }} message @param {unknown} input
 */
export function notTheMessage(message, input) {
  const i = /** @type {Record<string, unknown>} */ (input && typeof input === 'object' ? input : {});
  const extra = Object.keys(i).filter((k) => !MESSAGE_FIELDS.has(k) && !(k === 'bodyType' && i[k] === 'text') && !QUIET(i[k]));
  if (extra.length) return `It carries ${extra.join(', ')}, which you did not review.`;
  const to = addresses(i.to);
  if (to.length !== 1 || to[0] !== message.to.trim().toLowerCase()) return `It goes to ${to.join(', ') || 'no one'}, not ${message.to}.`;
  const copied = [...addresses(i.cc), ...addresses(i.bcc)];
  if (copied.length) return `It copies ${copied.join(', ')}, who you did not review.`;
  if (same(i.subject) !== same(message.subject)) return 'Its subject is not the one you reviewed.';
  if (same(i.body) !== same(message.body)) return 'Its message is not the one you reviewed.';
  return '';
}

// Writes to GitHub or the web from the shell, refused in a run nobody clicked: what it makes stays on its branch
// until a person reviews it, and these reach people at once.
const WRITE = "['\"]?(POST|PUT|PATCH|DELETE|post|put|patch|delete)\\b";
const UNATTENDED = [
  /\bgh\s+pr\s+(comment|review|merge|close|reopen|edit|ready|lock|unlock)\b/,
  /\bgh\s+issue\s+(comment|create|close|reopen|edit|delete|transfer|lock|unlock|pin|unpin)\b/,
  new RegExp(`\\bgh\\s+api\\b[^;&|]*(\\s(-X|--method)[\\s=]*${WRITE}|\\s(-f|-F|--field|--raw-field|--input)\\b)`),
  new RegExp(`\\bcurl\\b[^;&|]*(\\s(-X|--request)[\\s=]*${WRITE}|\\s(-d|-F|-T|--data[\\w-]*|--form[\\w-]*|--json|--upload-file)\\b)`),
  /\bwget\b[^;&|]*\s--(post|body|method)/,
];

/**
 * Why an Action run may not make this call, or '' when nothing here stops it (its tool must still be one the
 * reviewed brief names, which the agent checks). `sent` is how many sends this run has already been let through.
 * @param {SendGuard | undefined} guard @param {string} tool @param {unknown} input @param {number} [sent]
 */
export function refusal(guard, tool, input, sent = 0) {
  if (!guard) return '';
  const command = /** @type {any} */ (input)?.command;
  if (guard.unattended && typeof command === 'string' && UNATTENDED.some((re) => re.test(command)))
    return 'This run started on its own, so it may not comment, review, merge or write to GitHub or the web. Leave that for a run the person starts, and finish the rest.';
  if (guard.unattended && guard.unknown?.includes(tool))
    return `This run started on its own, and the map does not know what ${tool} does, so it may not use it. Leave that for a run the person starts, and finish the rest.`;
  if (!sendsTool(tool)) return '';
  if (guard.unattended && !guard.message)
    return `This run started on its own, so it may not send, post or reply with ${tool}. Leave that for a run the person starts, and finish the rest.`;
  if (guard.message) {
    if (sent >= guard.left) return 'This Action already sent its one reviewed message. Do not send it again; report what was sent.';
    const why = notTheMessage(guard.message, input);
    return why ? `The map refused this send: ${why} Send exactly the reviewed recipient, subject and message, with no one else copied, or report that you cannot.` : '';
  }
  if (mailTool(tool)) return 'This Action has no reviewed email, so it may not send one.';
  return '';
}
