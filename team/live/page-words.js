// A line's words in lines of at most `fit` characters, so a long label wraps instead of covering its own line.
// Breaks between words; a word too long for a line breaks where its parts begin (DiscordInteractionsLambda →
// Discord, Interactions, Lambda), and only a part still too long is cut. A page module (see page-modules.js).

/** @param {string} text @param {number} fit the most characters a line holds @returns {string[]} */
export function wrapWords(text, fit) {
  const parts = String(text).trim().split(/\s+/).filter(Boolean).flatMap((word) => {
    if (word.length <= fit) return [{ word, joined: false }];
    const pieces = word.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[_\-/.])/).flatMap((p) => p.length <= fit ? [p] : p.match(new RegExp(`.{1,${fit}}`, 'g')) || []);
    return pieces.map((p, i) => ({ word: p, joined: i > 0 }));
  });
  /** @type {string[]} */
  const lines = [];
  for (const { word, joined } of parts) {
    const last = lines.at(-1), next = last === undefined ? word : joined ? last + word : `${last} ${word}`;
    if (last !== undefined && next.length <= fit) lines[lines.length - 1] = next;
    else lines.push(word);
  }
  return lines;
}
