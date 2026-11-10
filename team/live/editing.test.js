import { describe, expect, it } from 'vitest';

import { branchIds, editHistory, editSnapshot } from './editing.js';

/** @type {() => any} */ const map = () => ({ title: 'Map', nodes: [{id:'root',label:'Root'},{id:'child',label:'Child'},{id:'leaf',label:'Leaf'},{id:'other',label:'Other'}], edges: [{from:'root',to:'child'},{from:'child',to:'leaf'}], comments:[{text:'Keep this'}] });
describe('map editing',()=>{
  it('includes all descendants, folded or nested, without looping',()=>{
    const s=map();s.nodes[1].inside={nodes:[{id:'inside'}],edges:[]};s.edges.push({from:'leaf',to:'child'});
    expect([...branchIds(s,['child'])].sort()).toEqual(['child','inside','leaf']);
  });
  it('undoes and redoes a whole branch deletion in one step',()=>{
    const s=map(),h=editHistory(),before=editSnapshot(s);s.nodes=s.nodes.filter(n=>!['child','leaf'].includes(n.id));s.edges=[];
    h.record('Duy',before,editSnapshot(s));expect(h.apply('Duy','undo',s).ok).toBe(true);expect(s.nodes.map(n=>n.id).sort()).toEqual(['child','leaf','other','root']);expect(s.edges).toHaveLength(2);expect(s.comments).toEqual([{text:'Keep this'}]);
    expect(h.apply('Duy','redo',s).ok).toBe(true);expect(s.nodes.map(n=>n.id)).toEqual(['root','other']);expect(s.edges).toEqual([]);
  });
  it('keeps another person’s unrelated edits and refuses conflicts',()=>{
    const s=map(),h=editHistory(),before=editSnapshot(s);s.nodes[1].label='New child';h.record('Duy',before,editSnapshot(s));
    s.nodes[3].label='Someone else';expect(h.apply('Duy','undo',s).ok).toBe(true);expect(s.nodes[3].label).toBe('Someone else');
    s.nodes[1].label='Conflicting edit';expect(h.apply('Duy','redo',s).ok).toBe(false);expect(s.nodes[1].label).toBe('Conflicting edit');
  });
  it('does not orphan another person’s newly connected child',()=>{
    const s=map(),h=editHistory(),before=editSnapshot(s);s.nodes.push({id:'new'});h.record('Duy',before,editSnapshot(s));s.nodes.push({id:'later'});s.edges.push({from:'new',to:'later'});
    expect(h.apply('Duy','undo',s).ok).toBe(false);expect(s.nodes.some(n=>n.id==='new')).toBe(true);
  });
  it('respects access changes when undoing a previous edit',()=>{
    const s=map(),h=editHistory(),before=editSnapshot(s);s.nodes[1].label='New child';h.record('Duy',before,editSnapshot(s));
    expect(h.apply('Duy','undo',s,()=>false).ok).toBe(false);expect(s.nodes[1].label).toBe('New child');
  });
  it('respects current access when undoing a line change',()=>{
    const s=map(),h=editHistory(),before=editSnapshot(s);s.edges[0].label='New line';h.record('Duy',before,editSnapshot(s));
    expect(h.apply('Duy','undo',s,n=>n.id!=='child').ok).toBe(false);expect(s.edges[0].label).toBe('New line');
  });
  it('clears redo after a new edit and separates people’s undo stacks',()=>{
    const s=map(),h=editHistory(),before=editSnapshot(s);s.nodes[0].label='A';h.record('Duy',before,editSnapshot(s));expect(h.apply('Other','undo',s).ok).toBe(false);
    h.apply('Duy','undo',s);const prev=editSnapshot(s);s.nodes[0].label='B';h.record('Duy',prev,editSnapshot(s));expect(h.apply('Duy','redo',s).ok).toBe(false);
  });
});
