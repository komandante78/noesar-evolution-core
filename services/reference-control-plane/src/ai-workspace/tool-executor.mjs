// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { guardedFetch } from './address-guard.mjs';

const LOCAL_HOSTS=new Set(['localhost','127.0.0.1','::1','host.docker.internal']);
function err(message,status=400){return Object.assign(new Error(message),{status});}
function privateV4(host){const p=host.split('.').map(Number);return p.length===4&&!p.some(Number.isNaN)&&(p[0]===10||p[0]===127||(p[0]===192&&p[1]===168)||(p[0]===172&&p[1]>=16&&p[1]<=31));}
function endpoint(value,external){let url;try{url=new URL(String(value));}catch{throw err('Tool endpoint is invalid.');}const host=url.hostname.toLowerCase();if(url.username||url.password||url.hash)throw err('Tool endpoint cannot contain credentials or fragments.');if(['169.254.169.254','metadata.google.internal','100.100.100.200'].includes(host))throw err('Metadata endpoints are forbidden.');const local=LOCAL_HOSTS.has(host)||privateV4(host)||(isIP(host)===6&&(host==='::1'||host.startsWith('fc')||host.startsWith('fd')));if(external){if(url.protocol!=='https:')throw err('External tools require HTTPS.');if(local)throw err('External tools cannot target private or loopback networks.');}else if(!local)throw err('Local tools must target loopback or a private network.');return url.toString();}
async function readJson(response){const text=await response.text();if(text.length>2*1024*1024)throw err('Tool response exceeded 2 MiB.',502);try{return text?JSON.parse(text):{};}catch{return{text};}}
function stdioCall(tool,input,signal){
  return new Promise((resolve,reject)=>{
    const allowed=new Set(String(process.env.NOESAR_MCP_ALLOWED_EXECUTABLES??'').split(',').map((v)=>v.trim()).filter(Boolean));
    const command=String(tool.config?.command??'');if(!allowed.has(command))return reject(err('MCP stdio executable is not allowlisted.',403));
    const args=Array.isArray(tool.config?.args)?tool.config.args.map(String):[];
    const child=spawn(command,args,{shell:false,stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH,HOME:process.env.HOME??'/nonexistent',LANG:'C.UTF-8'}});
    let output='';let errors='';let settled=false;const timeout=setTimeout(()=>finish(err('MCP stdio tool timed out.',504)),Math.min(tool.timeoutMs??60_000,120_000));
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timeout);child.kill('SIGKILL');error?reject(error):resolve(value);};
    signal?.addEventListener('abort',()=>finish(Object.assign(new Error('Tool execution stopped.'),{name:'AbortError'})),{once:true});
    child.stderr.on('data',(chunk)=>{errors+=chunk;if(errors.length>64*1024)errors=errors.slice(-64*1024);});
    child.stdout.on('data',(chunk)=>{output+=chunk;if(output.length>2*1024*1024)return finish(err('MCP stdio output exceeded 2 MiB.',502));for(const line of output.split(/\r?\n/)){if(!line.trim())continue;try{const value=JSON.parse(line);if(value.id===2){if(value.error)return finish(err(value.error.message??'MCP tool error',502));return finish(null,value.result);}}catch{}}});
    child.on('error',(error)=>finish(err(`MCP stdio launch failed: ${error.message}`,502)));
    child.on('exit',(code)=>{if(!settled)finish(err(`MCP stdio exited before response (${code}): ${errors}`.slice(0,2000),502));});
    const initialize={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'NOESAR Evolution',version:'1.0.0'}}};
    const initialized={jsonrpc:'2.0',method:'notifications/initialized',params:{}};
    const call={jsonrpc:'2.0',id:2,method:'tools/call',params:{name:tool.config?.remoteToolName??tool.name,arguments:input??{}}};
    child.stdin.write(`${JSON.stringify(initialize)}\n${JSON.stringify(initialized)}\n${JSON.stringify(call)}\n`);
  });
}

export class ToolExecutor{
  // `lookup`: injectable DNS resolution, mirroring ProviderGateway's own `this.lookup` — unset
  // in production (guardedFetch's own default, real node:dns, applies), overridable only by a
  // test that needs to prove the "a name resolves inward at call time" refusal without a real
  // DNS record (F4-010, D-0665).
  constructor({vault,ledger,lookup}={}){this.vault=vault;this.ledger=ledger;this.lookup=lookup;}
  async execute(tool,input,{actorId='system',projectId=null,signal}={}){
    if(tool.disabled)throw err('Tool is disabled.',403);
    if(tool.external){if(!tool.consent?.granted)throw err('Explicit external-tool consent is required.',403);if(tool.consent.projectIds?.length&&(!projectId||!tool.consent.projectIds.includes(projectId)))throw err('Tool consent does not cover this project.',403);}
    const started=Date.now();let result;
    if(tool.transport==='mcp-stdio')result=await stdioCall(tool,input,signal);
    else{
      const url=endpoint(tool.endpoint,Boolean(tool.external));const credential=this.vault.resolve({id:`tool:${tool.id}`,encryptedCredential:tool.encryptedCredential,credentialEphemeral:tool.credentialEphemeral});
      const headers={'content-type':'application/json','user-agent':'NOESAR-Evolution/1.0',...(tool.config?.headers??{})};if(credential)headers.authorization=`Bearer ${credential}`;
      let payload;
      if(tool.transport==='mcp-http')payload={jsonrpc:'2.0',id:randomUUID(),method:'tools/call',params:{name:tool.config?.remoteToolName??tool.name,arguments:input??{}}};
      else payload=input??{};
      const timeout=AbortSignal.timeout(Math.min(tool.timeoutMs??60_000,120_000));const combined=signal?AbortSignal.any([signal,timeout]):timeout;
      // F4-010, closed s336. `endpoint()` above checked the hostname STRING; this checks the
      // address that is actually reached and pins it for the life of the call — so a name
      // resolving inward is refused, and a resolver cannot change its answer between the check
      // and the connection. EXTERNAL tools only: a local tool is supposed to reach a private
      // address, and sending it through a guard whose job is to refuse those would break the
      // one case that is meant to work.
      const send=tool.external?guardedFetch:fetch;
      const init={method:tool.config?.method??'POST',headers,body:['GET','HEAD'].includes(tool.config?.method)?undefined:JSON.stringify(payload),signal:combined};
      const response=tool.external?await send(url,init,{lookup:this.lookup}):await send(url,init);
      const value=await readJson(response);if(!response.ok)throw err(`Tool request failed (${response.status}): ${value.error?.message??value.error??value.text??'unknown error'}`,502);
      if(tool.transport==='mcp-http'&&value.error)throw err(value.error.message??'MCP tool error',502);result=tool.transport==='mcp-http'?value.result:value;
    }
    this.ledger?.append({actor:actorId,action:'tool.executed',result:'success',details:{toolId:tool.id,transport:tool.transport,external:Boolean(tool.external),projectId,latencyMs:Date.now()-started}});
    return{toolId:tool.id,result,latencyMs:Date.now()-started};
  }
}
