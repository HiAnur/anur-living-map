// How Claude offers a change in Ask Claude: one call to propose_change, whose input is the change. The server
// reads that input from the answer's stream and checks it against the map before anyone sees it.
import { fileURLToPath } from 'node:url';

// An Action's task, as readPlannedTask (action-plan.js) checks it: Ask Claude's Action boxes, and the commitments a
// chat hands the map as action items (living_map_my_action in mcp.js), share it.
export const TASK = {
  type: 'object', additionalProperties: false, required: ['goal', 'result', 'inputs', 'steps', 'evidence', 'dependsOn'],
  description: 'An Action box\'s task. Leave it out for a Topic.',
  properties: {
    goal: { type: 'string', description: 'The concrete task and why it advances its parent.' },
    result: { type: 'string', description: 'The checkable deliverable.' },
    destination: { type: 'string', description: 'Where to save or attach the result, or empty when unknown.' },
    inputs: { type: 'array', items: { type: 'string' }, description: 'Context or input it needs.' },
    steps: { type: 'array', minItems: 1, items: { type: 'string' }, description: 'Concrete steps.' },
    evidence: { type: 'array', minItems: 1, items: { type: 'string' }, description: 'Proof it was done.' },
    dependsOn: { type: 'array', items: { type: 'string' }, description: 'Ids of Action boxes that must finish first.' },
    readiness: { type: 'string', enum: ['ready', 'needs_information', 'waiting'] },
    blockers: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['detail', 'resolver'], properties: {
      detail: { type: 'string', description: 'The missing fact, access or decision.' },
      resolver: { type: 'string', description: 'Who or what can resolve it.' } } } },
  },
};
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
    task: TASK,
    diagram: { type: 'object' },
  },
};
// Something the person said they will do themselves, in their own words: the map, not this call, decides whether it
// becomes their Action draft (action-items.js). It carries no owner: it is always the speaker's.
export const ACTION_ITEM = {
  type: 'object', additionalProperties: false, required: ['quote', 'title', 'task'],
  properties: {
    quote: { type: 'string', description: 'Their exact words saying they will do it, copied from their own message ("I\'ll send Dan the pricing by Thursday").' },
    title: { type: 'string', description: 'The box name: what they will do, in a few words ("Send Dan the pricing").' },
    sub: { type: 'string', description: 'The second line on the box, in a few words.' },
    under: { type: 'string', description: 'The id of the box it belongs under, when one fits.' },
    task: { ...TASK, description: 'What they will do: a goal, a checkable result, at least one step and how to know it is done.' },
  },
};
const line = { type: 'object', required: ['from', 'to'], properties: { from: id, to: id, label: { type: 'string', description: 'What happens on the line, in a few plain words.' } } };
export const PROPOSE_SCHEMA = {
  type: 'object',
  properties: {
    nodes: { type: 'array', items: box, description: 'Boxes to add, or to change by their existing id.' },
    edges: { type: 'array', items: line, description: 'Lines to add.' },
    remove: { type: 'array', items: { type: 'string' }, description: 'Ids of boxes to take off the map with their lines. Draw a line into each box that hung under one of them, from the box it hangs under now; a box given none moves up under the removed box\'s own parent.' },
    unlink: { type: 'array', items: { type: 'object', required: ['from', 'to'], properties: { from: id, to: id } }, description: 'Lines to take off, leaving both boxes.' },
    start: { type: 'string', description: 'The id of the box the map starts from, when reorganizing.' },
    tidy: { type: 'boolean', description: 'True when reorganizing: on Apply the map places every box itself.' },
    actionItems: { type: 'array', items: ACTION_ITEM, description: 'What the person who asked said they will do themselves, with a checkable result, quoted in their own words. The map makes each their Action draft at once, apart from the rest of the change; never your own suggestions or someone else\'s work.' },
    memory: { type: 'array', description: 'What the person asked you to remember, or to make a rule for you.', items: { type: 'object', required: ['kind', 'text'], properties: {
      kind: { type: 'string', enum: ['instruction', 'memory'], description: '"instruction" for a rule you must follow, "memory" for something to keep in mind.' },
      box: { type: ['string', 'null'], description: 'The box it is about, or null for the whole map.' },
      text: { type: 'string', description: 'One short line.' } } } },
  },
};

/** @type {McpServer} */
export const PROPOSE_SERVER = { command: process.execPath, args: [fileURLToPath(new URL('./propose-mcp.js', import.meta.url))], tools: ['propose_change'] };
