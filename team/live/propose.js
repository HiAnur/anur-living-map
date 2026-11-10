// How Claude offers a change in Ask Claude: one call to propose_change, whose input is the change. The server
// reads that input from the answer's stream and checks it against the map before anyone sees it.
import { fileURLToPath } from 'node:url';

const id = { type: 'string', description: 'A box id exactly as listed, or a new lowercase id for a new box.' };
const box = {
  type: 'object', required: ['id'],
  properties: {
    id,
    label: { type: 'string', description: 'The box name. Needed for a new box.' },
    sub: { type: 'string', description: 'The second line on the box: what it is, in a few words. Needed for a new box.' },
    desc: { type: 'string', description: 'A short first line, then "- " bullets, one point each.' },
    state: { type: 'string', enum: ['new', 'todo', 'assumed-gone', 'gone'] },
    boxType: { type: 'string', enum: ['topic', 'action'] },
    task: { type: 'object', description: 'An Action box\'s task, as the instructions describe.' },
    diagram: { type: 'object' },
  },
};
const line = { type: 'object', required: ['from', 'to'], properties: { from: id, to: id, label: { type: 'string', description: 'What happens on the line, in a few plain words.' } } };
export const PROPOSE_SCHEMA = {
  type: 'object',
  properties: {
    nodes: { type: 'array', items: box, description: 'Boxes to add, or to change by their existing id.' },
    edges: { type: 'array', items: line, description: 'Lines to add.' },
    remove: { type: 'array', items: { type: 'string' }, description: 'Ids of boxes to take off the map with their lines.' },
    unlink: { type: 'array', items: { type: 'object', required: ['from', 'to'], properties: { from: id, to: id } }, description: 'Lines to take off, leaving both boxes.' },
    start: { type: 'string', description: 'The id of the box the map starts from, when reorganizing.' },
    tidy: { type: 'boolean', description: 'True when reorganizing: on Apply the map places every box itself.' },
    memory: { type: 'array', items: { type: 'object', required: ['kind', 'text'], properties: {
      kind: { type: 'string', enum: ['instruction', 'memory'] }, box: { type: ['string', 'null'] }, text: { type: 'string' } } } },
  },
};

export const PROPOSE_TOOL = 'mcp__map_propose__propose_change';
export const PROPOSE_SERVER = { command: process.execPath, args: [fileURLToPath(new URL('./propose-mcp.js', import.meta.url))] };
