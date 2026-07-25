// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';

const MAX_INPUT = 48 * 1024 * 1024;
const MAX_TEXT = 32 * 1024 * 1024;
const MAX_ENTRY = 8 * 1024 * 1024;
const MAX_ENTRIES = 1000;
const TEXT_EXTENSIONS = new Set(['.txt','.md','.markdown','.csv','.tsv','.json','.jsonl','.yaml','.yml','.xml','.html','.htm','.css','.js','.mjs','.cjs','.ts','.tsx','.jsx','.py','.rs','.go','.java','.c','.h','.cpp','.hpp','.sh','.ps1','.sql','.toml','.ini','.conf','.log','.tex','.rtf']);
const OFFICE_EXTENSIONS = new Set(['.docx','.xlsx','.pptx','.odt','.ods','.odp','.epub']);
const IMAGE_EXTENSIONS = new Set(['.png','.jpg','.jpeg','.webp','.tif','.tiff','.bmp']);
const MEDIA_EXTENSIONS = new Set(['.mp3','.wav','.m4a','.aac','.flac','.ogg','.mp4','.mkv','.mov','.webm','.avi']);

function run(command,args,{maxBuffer=MAX_TEXT}={}){
  const result=spawnSync(command,args,{encoding:'utf8',maxBuffer,timeout:120_000,env:{PATH:process.env.PATH}});
  if(result.error?.code==='ENOENT')return{available:false,ok:false,error:`${command} is not installed.`};
  if(result.status!==0)return{available:true,ok:false,error:(result.stderr||`${command} failed`).trim().slice(0,2000)};
  return{available:true,ok:true,stdout:result.stdout};
}
function cleanXml(value){return String(value).replace(/<w:tab\/?\s*>/g,'\t').replace(/<w:br\/?\s*>/g,'\n').replace(/<[^>]+>/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/[ \t]+/g,' ').replace(/\n\s+/g,'\n').trim();}
function safeEntry(name){return name && !name.startsWith('/') && !name.includes('\\') && !name.split('/').includes('..') && !name.includes('\0');}
function sha256(bytes){return createHash('sha256').update(bytes).digest('hex');}

export function extractorCapabilities(){
  const command=(name)=>run('sh',['-c',`command -v ${name}`],{maxBuffer:4096}).ok;
  return{
    text:true,archives:command('unzip'),pdf:command('pdftotext'),ocr:command('tesseract'),mediaMetadata:command('ffprobe'),
    officeXml:command('unzip'),audioVideoTranscription:'provider-or-installed-tool-required',
    limits:{maxInputBytes:MAX_INPUT,maxExtractedTextBytes:MAX_TEXT,maxArchiveEntries:MAX_ENTRIES,maxArchiveEntryBytes:MAX_ENTRY},
  };
}

export class FileExtractor{
  constructor({blobRoot}){this.blobRoot=blobRoot;mkdirSync(blobRoot,{recursive:true,mode:0o700});}
  delete(blobId){if(!/^[0-9a-f-]{36}$/i.test(String(blobId)))return false;rmSync(join(this.blobRoot,String(blobId)),{recursive:true,force:true});return true;}
  extract({name,mimeType='application/octet-stream',bytesBase64}){
    const bytes=Buffer.from(String(bytesBase64??''),'base64');
    if(!bytes.length)throw Object.assign(new Error('File content is empty.'),{status:400});
    if(bytes.length>MAX_INPUT)throw Object.assign(new Error(`File exceeds ${MAX_INPUT} byte ingestion limit.`),{status:413});
    const safeName=basename(String(name??'upload.bin')).replace(/[^a-zA-Z0-9._-]+/g,'_').slice(0,180)||'upload.bin';
    const id=randomUUID();const dir=join(this.blobRoot,id);mkdirSync(dir,{recursive:true,mode:0o700});const path=join(dir,safeName);writeFileSync(path,bytes,{mode:0o600});
    const extension=extname(safeName).toLowerCase();
    let text='';let status='complete';let extractor='utf8';let metadata={};let warning=null;
    if(TEXT_EXTENSIONS.has(extension)||mimeType.startsWith('text/')||['application/json','application/xml','application/yaml'].includes(mimeType)){
      text=bytes.toString('utf8').replace(/\0/g,'');
    }else if(extension==='.pdf'||mimeType==='application/pdf'){
      extractor='pdftotext';const result=run('pdftotext',['-layout',path,'-']);if(result.ok)text=result.stdout;else{status=result.available?'extraction_failed':'extractor_unavailable';warning=result.error;}
    }else if(OFFICE_EXTENSIONS.has(extension)||mimeType.includes('officedocument')||mimeType.includes('opendocument')){
      extractor='office-xml';const list=run('unzip',['-Z1',path]);if(!list.ok){status=list.available?'extraction_failed':'extractor_unavailable';warning=list.error;}else{
        const entries=list.stdout.split(/\r?\n/).filter(Boolean).filter(safeEntry).slice(0,MAX_ENTRIES);
        const preferred=entries.filter((entry)=>/^(word\/document\.xml|xl\/sharedStrings\.xml|ppt\/slides\/slide\d+\.xml|content\.xml|OEBPS\/.*\.(?:xhtml|html))$/.test(entry));
        const parts=[];for(const entry of preferred){const result=run('unzip',['-p',path,entry],{maxBuffer:MAX_ENTRY});if(result.ok)parts.push(`\n--- ${entry} ---\n${cleanXml(result.stdout)}`);}
        text=parts.join('\n').trim();metadata.entries=entries.length;if(!text){status='extraction_failed';warning='No supported text-bearing XML entries found.';}
      }
    }else if(extension==='.zip'||mimeType==='application/zip'||mimeType==='application/x-zip-compressed'){
      extractor='safe-zip-text';const list=run('unzip',['-Z1',path]);if(!list.ok){status=list.available?'extraction_failed':'extractor_unavailable';warning=list.error;}else{
        const all=list.stdout.split(/\r?\n/).filter(Boolean);if(all.length>MAX_ENTRIES)throw Object.assign(new Error('Archive contains too many entries.'),{status:413});
        const unsafe=all.filter((entry)=>!safeEntry(entry));if(unsafe.length)throw Object.assign(new Error('Archive contains unsafe paths.'),{status:400});
        const selected=all.filter((entry)=>TEXT_EXTENSIONS.has(extname(entry).toLowerCase())).slice(0,250);const parts=[];let total=0;
        for(const entry of selected){const result=run('unzip',['-p',path,entry],{maxBuffer:MAX_ENTRY});if(!result.ok)continue;total+=Buffer.byteLength(result.stdout);if(total>MAX_TEXT)break;parts.push(`\n--- ${entry} ---\n${result.stdout}`);}
        text=parts.join('\n').trim();metadata={entries:all.length,textEntries:selected.length};if(!text){status='indexed_metadata';warning='Archive inventory stored; no supported text entries extracted.';}
      }
    }else if(IMAGE_EXTENSIONS.has(extension)||mimeType.startsWith('image/')){
      extractor='tesseract-ocr';const result=run('tesseract',[path,'stdout']);if(result.ok)text=result.stdout;else{status=result.available?'extraction_failed':'extractor_unavailable';warning=result.error;}
    }else if(MEDIA_EXTENSIONS.has(extension)||mimeType.startsWith('audio/')||mimeType.startsWith('video/')){
      extractor='ffprobe';const result=run('ffprobe',['-v','error','-show_format','-show_streams','-of','json',path]);if(result.ok){metadata.media=JSON.parse(result.stdout);status='transcription_required';warning='Media metadata indexed. Configure a local speech tool or explicitly approved multimodal provider for transcription.';}else{status=result.available?'metadata_failed':'extractor_unavailable';warning=result.error;}
    }else{status='extractor_required';warning='No extractor is registered for this file type.';}
    if(Buffer.byteLength(text)>MAX_TEXT)text=Buffer.from(text).subarray(0,MAX_TEXT).toString('utf8');
    return{blobId:id,blobPath:path,storedName:safeName,byteLength:bytes.length,sha256:sha256(bytes),mimeType,extension,text,status,extractor,metadata,warning};
  }
}
