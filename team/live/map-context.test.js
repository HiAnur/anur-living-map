import { spawn } from 'node:child_process';
import readline from 'node:readline';

import { expect, it } from 'vitest';

import { contextObjects, describeMap, openContext } from './map-context.js';

/** @type {() => any} */ const state = () => ({ title: 'Pilot launch', desc: 'Plan a pilot for independent designers, including pricing, support and launch criteria.', start: 'root',
  nodes: [{id:'root',label:'Pilot',area:'product',sub:'Launch for designers',inside:{nodes:[{id:'child',label:'Pricing',area:'product',desc:'Charge per active seat. Test willingness to pay.'}],edges:[]}}, {id:'secret',label:'Private finances',area:'finance',desc:'Secret finance notes',action:{transcript:'private action'}}],
  edges:[{from:'root',to:'child'},{from:'root',to:'secret'}],
  people:[{id:'Reader',sees:'product'}], calls:[{id:'price',node:'child',text:'Which pricing?',picked:'Per seat',status:'answered'},{id:'launch',node:'root',text:'When do we launch?',status:'open'},{node:'secret',text:'Private question',status:'open'}],
  memory:[{id:'rule',text:'Ask before changing prices',kind:'instruction'},{id:'private',box:'secret',text:'Private memory'}],
  threads:{'@Owner':[{text:'private chat'}]}, linked:[{file:'/private/transcript'}], linkSharing:{mode:'edit',token:'secret-token'}, project:'/private/folder' });

it('describes purpose, nested topics, settled choices, questions and memory without private runtime state', () => {
  const s = state(), before = structuredClone(s), d = describeMap('pilot',s,'Owner');
  for (const word of ['independent designers','Pricing','willingness to pay','Per seat','When do we launch?','Ask before changing prices']) expect(d.description).toContain(word);
  const json = JSON.stringify(contextObjects(s,'Owner'));
  for (const secret of ['secret-token','private chat','private action','/private/']) expect(json).not.toContain(secret);
  expect(s).toEqual(before);
  s.nodes[0].sub = 'New audience'; expect(describeMap('pilot',s,'Owner').revision).not.toBe(d.revision);
  expect(describeMap('pilot',s,'Owner').description).toContain('New audience');
});

it('filters nested content and attached decisions and memories for area-limited readers', () => {
  const s=state(), objects=contextObjects(s,'Reader'), d=describeMap('pilot',s,'Reader');
  expect(objects.map.nodes.map(n=>n.id)).toEqual(['root','child']);
  expect(objects.map.edges).toEqual([{from:'root',to:'child'}]);
  expect(objects.map.description).toBe('');
  for (const text of ['Private finances','Secret finance notes','Private question','Private memory','independent designers']) expect(JSON.stringify([objects,d])).not.toContain(text);
});

it('discovers summaries first, reads only requested sections, pages, and rechecks revoked access', async () => {
  const s=state(); let allowed=true; const loaded=[];
  const session=await openContext({who:'Reader',maps:()=>[{id:'pilot',allowed:()=>allowed,snapshot:()=>s},{id:'denied',allowed:()=>false,snapshot:()=>{throw new Error('must not read');}}],onLoad:x=>loaded.push(x)});
  try {
    expect(session.run('list_maps').maps.map(m=>m.id)).toEqual(['pilot']); expect(loaded).toHaveLength(0);
    expect(session.run('list_maps',{query:'private finances'}).maps).toHaveLength(0);
    const data=session.run('load_map',{id:'pilot',sections:['decisions']});
    expect(data.decisions).toHaveLength(2); expect(data.map).toBeUndefined(); expect(data.memory).toBeUndefined(); expect(loaded).toHaveLength(1);
    s.nodes.push(...Array.from({length:60},(_,i)=>({id:`n${i}`,label:`Topic ${i}`,desc:i===59?'A rare topic about accessibility':'Details',area:'product'})));
    expect(session.run('list_maps',{query:'accessibility'}).maps[0].description).toContain('accessibility');
    const first=session.run('load_map',{id:'pilot',sections:['map']}); expect(first.map.nodes).toHaveLength(50); expect(first.nextOffset).toBe(50);
    const last=session.run('load_map',{id:'pilot',sections:['map'],offset:50}); expect(last.map.nodes).toHaveLength(12); expect(last.nextOffset).toBeNull();
    allowed=false;expect(session.run('list_maps').maps).toHaveLength(0);expect(()=>session.run('load_map',{id:'pilot'})).toThrow('unavailable');
    for(const args of [{offset:-1},{offset:'0'},{sections:['threads']}]) expect(()=>session.run('load_map',{id:'pilot',...args})).toThrow();
  } finally {session.close();}
  expect(()=>session.run('list_maps')).toThrow('expired');
});

it('bounds discovery pages without losing maps', async () => {
  const s=state();s.nodes=Array.from({length:40},(_,i)=>({id:`n${i}`,label:`Box ${i}`,desc:'Detailed scope '.repeat(50)}));
  const session=await openContext({who:'Owner',maps:()=>Array.from({length:12},(_,i)=>({id:`map-${i}`,allowed:()=>true,snapshot:()=>s}))});
  try {
    let offset=0;const ids=[];
    do {const page=session.run('list_maps',{offset});ids.push(...page.maps.map(m=>m.id));offset=page.nextOffset;} while(offset!==null);
    expect(new Set(ids).size).toBe(12);
  } finally {session.close();}
});

it('serves only the scoped capability through the actual stdio tools', async () => {
  const session=await openContext({who:'Owner',maps:()=>[{id:'pilot',allowed:()=>true,snapshot:state}]});
  const config=session.servers.map_context;
  let child;
  try {
    expect((await fetch(config.env.LM_CONTEXT_URL,{method:'POST',body:'{}'})).status).toBe(403);
    expect((await fetch(config.env.LM_CONTEXT_URL,{method:'POST',headers:{authorization:`Bearer ${config.env.LM_CONTEXT_TOKEN}`,origin:'https://other.test'},body:'{}'})).status).toBe(403);
    child=spawn(config.command,config.args,{env:{...process.env,...config.env},stdio:['pipe','pipe','pipe']});
    const pending=new Map();let id=0;
    readline.createInterface({input:child.stdout}).on('line',line=>{const m=JSON.parse(line);pending.get(m.id)?.(m.result);});
    const call=(method,params)=>new Promise(resolve=>{const key=++id;pending.set(key,resolve);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:key,method,params})+'\n');});
    expect((await call('initialize')).capabilities).toHaveProperty('tools');
    expect((await call('tools/list')).tools.map(t=>t.name)).toEqual(['list_maps','load_map']);
    const catalog=await call('tools/call',{name:'list_maps',arguments:{}});expect(catalog.content[0].text).toContain('independent designers');
    const result=await call('tools/call',{name:'load_map',arguments:{id:'pilot'}});expect(JSON.parse(result.content[0].text).map.title).toBe('Pilot launch');
    expect((await call('tools/call',{name:'load_map',arguments:{id:'../secret'}})).isError).toBe(true);
    expect((await call('tools/call',{name:'edit_map',arguments:{}})).isError).toBe(true);
  } finally {child?.kill();session.close();}
});

it('connects a real map question to scoped context and records the loaded source without a model call', async () => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path'); const http = await import('node:http');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lm-context-')), dir=path.join(root,'app'), bin=path.join(root,'bin');
  fs.mkdirSync(dir);fs.mkdirSync(bin);
  for(const f of fs.readdirSync(import.meta.dirname)) if(/\.(js|json|html|md)$/.test(f) && fs.statSync(path.join(import.meta.dirname,f)).isFile()) fs.copyFileSync(path.join(import.meta.dirname,f),path.join(dir,f));
  fs.cpSync(path.join(import.meta.dirname, 'agents'), path.join(dir, 'agents'), { recursive: true });
  const make=(id,title,desc,extra={})=>{const home=path.join(dir,'maps',id);fs.mkdirSync(home,{recursive:true});fs.writeFileSync(path.join(home,'state.json'),JSON.stringify({title,desc,nodes:[{id:'root',label:title,sub:desc,x:0,y:0}],edges:[],calls:[],people:[{id:'Duy',role:'Admin',joined:'test'}],threads:{},log:[],...extra}));};
  make('current','Current project','Plan our new feature');make('pricing','Pilot pricing','Per-seat pricing research and buyer interviews');make('unrelated','Garden','Vegetable planting dates');make('hidden','Hidden map','Never reveal this map',{removedPeople:['Duy'],people:[]});
  fs.writeFileSync(path.join(bin,'claude'),`#!${process.execPath}
let prompt='';for await(const chunk of process.stdin)prompt+=chunk;
const config=JSON.parse(process.argv[process.argv.indexOf('--mcp-config')+1]);
const env=config.mcpServers.map_context.env;
const read=async(method,args)=>{const r=await fetch(env.LM_CONTEXT_URL,{method:'POST',headers:{authorization:'Bearer '+env.LM_CONTEXT_TOKEN},body:JSON.stringify({method,args})});return r.json();};
const catalog=await read('list_maps',{});
if(prompt.includes('Hidden map')||catalog.maps.some(m=>m.id==='current'||m.id==='hidden'))throw Error('Scope failed');
const excluded=await read('load_map',{id:'unrelated'});
if(!excluded.error)throw Error('Unchecked map was readable');
if(!catalog.maps.length){
 const denied=await read('load_map',{id:'pricing'});
 if(!denied.error)throw Error('Default leaked map context');
 console.log(JSON.stringify({type:'result',result:'No external maps selected.'}));process.exit(0);
}
if(catalog.maps.length!==1||catalog.maps[0].id!=='pricing'||prompt.includes('Vegetable planting dates'))throw Error('Unchecked description leaked');
const selected=await read('load_map',{id:'pricing',sections:['map']});
console.log(JSON.stringify({type:'result',result:'Reference: ['+selected.name+']('+selected.href+'). '+selected.map.description}));
`,{mode:0o755});
  const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',/** @type {() => void} */ (r)));const port=/** @type {import('node:net').AddressInfo} */ (reserve.address()).port;await new Promise(r=>reserve.close(r));
  const base=`http://127.0.0.1:${port}`, env={...process.env,PATH:bin+path.delimiter+process.env.PATH,LIVING_MAP_USERS:path.join(root,'users.db'),LIVING_MAP_LOGIN_URL:''};
  let child;
  const start=async()=>{child=spawn(process.execPath,[path.join(dir,'server.js'),String(port)],{cwd:dir,env,stdio:'ignore'});for(let i=0;i<80;i++){try{if((await fetch(base+'/api/version')).ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error('Server did not start');};
  const stop=async()=>{if(child?.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}};
  try {
    await start();
    const act=async(data)=>fetch(base+'/current/api/act',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({by:'Duy',...data})});
    expect((await act({type:'describemap',description:'Background: serve small design teams. Decide what to charge.'})).status).toBe(200);
    expect((await (await fetch(base+'/current/api/context-description')).json()).description).toContain('small design teams');
    const catalog=await (await fetch(base+'/api/map-context')).json();expect(catalog.maps.some(m=>m.id==='pricing')).toBe(true);
    expect((await fetch(base+'/api/map-context',{headers:{'sec-fetch-site':'same-origin'}})).status).toBe(401);
    const objects=await (await fetch(base+'/api/map-context?tool=load_map&id=pricing&sections=map')).json();expect(objects.map.title).toBe('Pilot pricing');expect(objects.memory).toBeUndefined();
    const ask=async()=>{
      expect((await act({type:'ask',text:'How should we price this feature?'})).status).toBe(200);
      for(let i=0;i<80;i++){const s=await (await fetch(base+'/current/api/state')).json();const m=s.threads['@Duy']?.at(-1);if(m?.who==='Claude'&&!m.thinking)return m;await new Promise(r=>setTimeout(r,50));}
      throw Error('No reply');
    };
    expect((await ask()).text).toBe('No external maps selected.');
    expect((await act({type:'contextmap',id:'hidden',include:true})).status).toBe(400);
    expect((await act({type:'contextmap',id:'pricing',include:true})).status).toBe(200);
    expect((await act({type:'ask',text:'How should we price this feature?'})).status).toBe(200);
    let reply;
    for(let i=0;i<80;i++){const s=await (await fetch(base+'/current/api/state')).json();reply=s.threads['@Duy']?.at(-1);if(reply?.who==='Claude'&&!reply.thinking)break;await new Promise(r=>setTimeout(r,50));}
    expect(reply.text).toContain('Per-seat pricing research');expect(reply.sources.map(m=>m.id)).toEqual(['pricing']);
    await stop();await start();
    const restored=await (await fetch(base+'/current/api/state')).json();
    expect(restored.desc).toContain('small design teams');expect(restored.contextMapIds).toEqual(['pricing']);
    expect((await act({type:'contextmap',id:'pricing',include:false})).status).toBe(200);
    // Earlier sourced replies remain in the conversation, but cannot unlock new reads.
    expect((await ask()).text).toBe('No external maps selected.');
  } finally {await stop();fs.rmSync(root,{recursive:true,force:true});}
},15000);
