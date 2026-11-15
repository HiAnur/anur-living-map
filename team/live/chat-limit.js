// The most characters one chat message may hold, in the map's own chat, a box's chat and a linked chat's pane.
// It is large enough for a pasted document. The page refuses a longer message with a notice and the server
// refuses it too, so a message reaches Claude whole or not at all, never cut short. A page module (see page-modules.js).

export const CHAT_MAX = 20000;

/** What the page says about a message over the limit, or '' when it fits. @param {string} text */
export function chatTooLong(text) {
  return text.length > CHAT_MAX ? `This message is ${text.length.toLocaleString('en-US')} characters. The chat takes up to ${CHAT_MAX.toLocaleString('en-US')}: shorten it or send it in parts.` : '';
}
