// The page's own modules: the files index.html imports. Every place that serves the page serves them beside it
// (this server, a share link, the cloud copy), and Share as a file writes each back into the one file it saves,
// which opens with no server, where a module cannot be fetched. So a page module imports nothing, and no name it
// declares at its top level is declared by the page's script or another page module: written in place of its
// import, it is the same code. page-modules.test.js holds these rules.

export const PAGE_MODULES = ['page-layout.js', 'page-search.js', 'page-share.js'];

/** The page with every page module written in place of its import line. @param {string} html @param {(file: string) => string} read */
export function inlineModules(html, read) {
  return html.replace(/^import \{[^}\n]*\} from '\.\/([\w-]+\.js)';$/gm, (line, file) =>
    PAGE_MODULES.includes(file) ? read(file).replace(/^export /gm, '').trimEnd() : line);
}
