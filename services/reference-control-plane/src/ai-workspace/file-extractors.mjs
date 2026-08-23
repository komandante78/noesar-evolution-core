// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { transcribe, voiceRoutingFrom, VoiceJob, VoiceEngineError } from '../voice-engine.mjs';

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

/**
 * What the BYTES say this is — closing `F4-011`, open and accepted since phase 4.
 *
 * > extraction is routed by filename extension and declared MIME type, with no content sniffing
 * > SEC-24: PDF bytes declared text/plain are stored as text; text declared application/pdf
 * >         reaches pdftotext and fails extraction
 *
 * Both halves of that evidence are a CLIENT deciding what this product does with a file. The
 * register called it a correctness limitation and not an execution risk, which is true and is why
 * it could wait — extractors run `shell:false` on a temp path and nothing is executed. It is
 * still a lie told to whoever reads the source back: they asked for a PDF, and the product stored
 * its raw bytes as though they were prose.
 *
 * Deliberately SHORT. Every signature is a fixed prefix at a fixed offset — no parser, nothing to
 * overflow, nothing to keep up to date. A file this cannot identify comes back `unknown` and the
 * declared type still decides: sniffing narrows what a client can misdeclare, it does not become
 * a second and worse guesser for everything else.
 */
export function sniffContentType(bytes){
  const head=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes??[]);
  if(head.length<4)return 'unknown';
  const starts=(...signature)=>signature.every((byte,index)=>head[index]===byte);
  const at=(from,to)=>head.subarray(from,to).toString('latin1');
  if(starts(0x25,0x50,0x44,0x46))return 'pdf'; // %PDF
  // A zip is ALSO every Office and OpenDocument file and every epub — same container, different
  // contents — so this reports the container and the caller keeps using the name to choose
  // between the two zip paths. Sniffing tells you what a thing is, not what it is for.
  if(starts(0x50,0x4b,0x03,0x04)||starts(0x50,0x4b,0x05,0x06)||starts(0x50,0x4b,0x07,0x08))return 'zip';
  if(starts(0x1f,0x8b))return 'gzip';
  if(starts(0x89,0x50,0x4e,0x47))return 'png';
  if(starts(0xff,0xd8,0xff))return 'jpeg';
  if(starts(0x47,0x49,0x46,0x38))return 'gif';
  if(head.length>=12&&starts(0x52,0x49,0x46,0x46)&&at(8,12)==='WEBP')return 'webp';
  if(head.length>=12&&starts(0x52,0x49,0x46,0x46)&&at(8,12)==='WAVE')return 'wav';
  if(head.length>=12&&at(4,8)==='ftyp')return 'mp4';
  if(starts(0x1a,0x45,0xdf,0xa3))return 'matroska'; // mkv and webm share it
  if(starts(0x4f,0x67,0x67,0x53))return 'ogg';
  if(starts(0x66,0x4c,0x61,0x43))return 'flac';
  if(starts(0x49,0x44,0x33))return 'mp3';
  if(starts(0x7f,0x45,0x4c,0x46))return 'elf'; // an executable, and worth naming as one
  if(starts(0x4d,0x5a))return 'pe'; // likewise
  return 'unknown';
}

/** Are these bytes text at all? A NUL says no, and so does anything that does not survive a round
 *  trip through UTF-8. Storing binary as prose is how the first half of SEC-24 ends up in a
 *  knowledge base as gibberish nobody can account for. */
export function looksLikeText(bytes){
  const head=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes??[]);
  const sample=head.subarray(0,4096);
  if(sample.includes(0))return false;
  return Buffer.compare(Buffer.from(sample.toString('utf8'),'utf8'),sample)===0;
}

/** How a sniffed type is expressed in the two things the dispatch below routes on. `null` means
 *  "the bytes have no opinion", and the declared type keeps its say. */
const SNIFFED_ROUTE={
  pdf:{extension:'.pdf',mimeType:'application/pdf',family:'pdf'},
  zip:{extension:'.zip',mimeType:'application/zip',family:'zip'},
  png:{extension:'.png',mimeType:'image/png',family:'image'},
  jpeg:{extension:'.jpg',mimeType:'image/jpeg',family:'image'},
  gif:{extension:'.gif',mimeType:'image/gif',family:'image'},
  webp:{extension:'.webp',mimeType:'image/webp',family:'image'},
  mp4:{extension:'.mp4',mimeType:'video/mp4',family:'media'},
  matroska:{extension:'.mkv',mimeType:'video/x-matroska',family:'media'},
  ogg:{extension:'.ogg',mimeType:'audio/ogg',family:'media'},
  flac:{extension:'.flac',mimeType:'audio/flac',family:'media'},
  wav:{extension:'.wav',mimeType:'audio/wav',family:'media'},
  mp3:{extension:'.mp3',mimeType:'audio/mpeg',family:'media'},
};

/** The family a DECLARED mime type belongs to, so a disagreement can be named. */
function declaredFamilyOf(mimeType,extension){
  if(mimeType==='application/pdf'||extension==='.pdf')return 'pdf';
  if(OFFICE_EXTENSIONS.has(extension)||mimeType.includes('officedocument')||mimeType.includes('opendocument'))return 'zip';
  if(extension==='.zip'||mimeType==='application/zip'||mimeType==='application/x-zip-compressed')return 'zip';
  if(IMAGE_EXTENSIONS.has(extension)||mimeType.startsWith('image/'))return 'image';
  if(MEDIA_EXTENSIONS.has(extension)||mimeType.startsWith('audio/')||mimeType.startsWith('video/'))return 'media';
  if(TEXT_EXTENSIONS.has(extension)||mimeType.startsWith('text/')||['application/json','application/xml','application/yaml'].includes(mimeType))return 'text';
  return null;
}

export function extractorCapabilities({visionCapableProviderCount=0}={}){
  const command=(name)=>run('sh',['-c',`command -v ${name}`],{maxBuffer:4096}).ok;
  return{
    text:true,archives:command('unzip'),pdf:command('pdftotext'),ocr:command('tesseract'),mediaMetadata:command('ffprobe'),
    officeXml:command('unzip'),audioVideoTranscription:voiceRoutingFrom()[VoiceJob.TRANSCRIBE]?.endpoint?'configured':'not-configured',
    // `D-0651`: declared, from the operator's own provider profiles — see `visionCapable` on
    // `provider-gateway.mjs`'s profile shape. Passed in rather than read here: this function has
    // no store, and reading one just to count a field would be a second, narrower store reader.
    imageCaption:visionCapableProviderCount>0?'configured':'not-configured',
    limits:{maxInputBytes:MAX_INPUT,maxExtractedTextBytes:MAX_TEXT,maxArchiveEntries:MAX_ENTRIES,maxArchiveEntryBytes:MAX_ENTRY},
  };
}

export class FileExtractor{
  // `transcribeImpl`/`routingImpl`/`runImpl` are injectable so a test can prove the wiring
  // below without a real speech server or `ffprobe` on the runner — every production call
  // site constructs this with no overrides and gets the real `voice-engine.mjs` and `spawnSync`.
  // `captionImpl` has no module-level default: unlike voice routing (read from `process.env`),
  // a vision-capable provider lives in the operator's provider profiles behind a `ProviderGateway`
  // instance this file never holds — `server.mjs` is the one place both exist, so it is the one
  // place that builds the bound function (`vision-caption.mjs`'s `captionImage`). `null` means
  // "no captioning wired", handled the same as "no provider configured" — a declared gap, not a
  // silent skip.
  constructor({blobRoot,transcribeImpl=transcribe,routingImpl=voiceRoutingFrom,runImpl=run,fetchImpl,captionImpl=null}){
    this.blobRoot=blobRoot;this.transcribeImpl=transcribeImpl;this.routingImpl=routingImpl;this.run=runImpl;this.fetchImpl=fetchImpl;this.captionImpl=captionImpl;
    mkdirSync(blobRoot,{recursive:true,mode:0o700});
  }
  delete(blobId){if(!/^[0-9a-f-]{36}$/i.test(String(blobId)))return false;rmSync(join(this.blobRoot,String(blobId)),{recursive:true,force:true});return true;}
  async extract({name,mimeType='application/octet-stream',bytesBase64}){
    const bytes=Buffer.from(String(bytesBase64??''),'base64');
    if(!bytes.length)throw Object.assign(new Error('File content is empty.'),{status:400});
    if(bytes.length>MAX_INPUT)throw Object.assign(new Error(`File exceeds ${MAX_INPUT} byte ingestion limit.`),{status:413});
    const safeName=basename(String(name??'upload.bin')).replace(/[^a-zA-Z0-9._-]+/g,'_').slice(0,180)||'upload.bin';
    const id=randomUUID();const dir=join(this.blobRoot,id);mkdirSync(dir,{recursive:true,mode:0o700});const path=join(dir,safeName);writeFileSync(path,bytes,{mode:0o600});
    const declaredExtension=extname(safeName).toLowerCase();
    const declaredMime=mimeType;
    let text='';let status='complete';let extractor='utf8';let metadata={};let warning=null;

    // ——— F4-011, closed s336: the bytes decide, and a disagreement is said out loud ————
    //
    // The dispatch below is UNCHANGED. What changed is what it dispatches ON: the two inputs are
    // rewritten from the signature before the chain runs, so every branch keeps working exactly
    // as it did and none of them has to learn about sniffing. Rewriting the inputs rather than
    // rewriting the chain is the difference between a fix and a rebuild — the chain is dense and
    // load-bearing, and a mistake inside it is a mistake in ingestion.
    //
    // Where the bytes say nothing (`unknown`), the declared type keeps its say. Sniffing narrows
    // what a client can misdeclare; it does not become a second guesser for everything else.
    const detected=sniffContentType(bytes);
    const route=SNIFFED_ROUTE[detected]??null;
    const declaredFamily=declaredFamilyOf(declaredMime,declaredExtension);
    const detectedFamily=route?.family??(detected==='unknown'&&looksLikeText(bytes)?'text':null);
    let extension=declaredExtension;
    if(route){extension=route.extension;mimeType=route.mimeType;}
    // The one case the table cannot express: a zip that the NAME says is an Office document is an
    // Office document. Same container, different contents — so the declared type is kept where it
    // is more specific than the signature rather than less.
    if(detected==='zip'&&(OFFICE_EXTENSIONS.has(declaredExtension)||declaredMime.includes('officedocument')||declaredMime.includes('opendocument'))){
      extension=declaredExtension;mimeType=declaredMime;
    }
    // The second half of SEC-24: "text declared application/pdf reaches pdftotext and fails".
    // No signature says "this is text" — text has none — so it is recognised by what it is NOT:
    // no NUL bytes and a clean UTF-8 round trip. That is only allowed to OVERRIDE a declared
    // binary type, never to claim a file whose signature was recognised: a PDF is valid UTF-8 for
    // its first few bytes too, and letting this rule outrank a real signature would undo the
    // first half of the same finding.
    if(!route&&detectedFamily==='text'&&declaredFamily&&declaredFamily!=='text'){
      extension='.txt';mimeType='text/plain';
    }
    metadata.detectedType=detected;
    if(declaredFamily&&detectedFamily&&declaredFamily!==detectedFamily){
      // Recorded, not merely acted on. An operator who uploaded something labelled one way and
      // got the other back has to be able to find out which the product believed and why.
      metadata.typeMismatch={declared:declaredMime,detected};
      warning=`declared ${declaredMime}, but the bytes are ${detected} — routed by the bytes`;
    }
    // An executable is never extracted from, whatever it was called. Nothing here runs it, but
    // treating an ELF as prose puts its bytes into a knowledge base and treating it as an archive
    // hands it to unzip. Naming it and stopping is the only honest answer.
    if(detected==='elf'||detected==='pe'){
      status='unsupported';extractor='none';
      warning=`refused: the bytes are a ${detected==='elf'?'Linux ELF':'Windows PE'} executable, whatever ${declaredMime} claimed`;
    }else if(TEXT_EXTENSIONS.has(extension)||mimeType.startsWith('text/')||['application/json','application/xml','application/yaml'].includes(mimeType)){
      text=bytes.toString('utf8').replace(/\0/g,'');
    }else if(extension==='.pdf'||mimeType==='application/pdf'){
      extractor='pdftotext';const result=this.run('pdftotext',['-layout',path,'-']);if(result.ok)text=result.stdout;else{status=result.available?'extraction_failed':'extractor_unavailable';warning=result.error;}
    }else if(OFFICE_EXTENSIONS.has(extension)||mimeType.includes('officedocument')||mimeType.includes('opendocument')){
      extractor='office-xml';const list=this.run('unzip',['-Z1',path]);if(!list.ok){status=list.available?'extraction_failed':'extractor_unavailable';warning=list.error;}else{
        const entries=list.stdout.split(/\r?\n/).filter(Boolean).filter(safeEntry).slice(0,MAX_ENTRIES);
        const preferred=entries.filter((entry)=>/^(word\/document\.xml|xl\/sharedStrings\.xml|ppt\/slides\/slide\d+\.xml|content\.xml|OEBPS\/.*\.(?:xhtml|html))$/.test(entry));
        const parts=[];for(const entry of preferred){const result=this.run('unzip',['-p',path,entry],{maxBuffer:MAX_ENTRY});if(result.ok)parts.push(`\n--- ${entry} ---\n${cleanXml(result.stdout)}`);}
        text=parts.join('\n').trim();metadata.entries=entries.length;if(!text){status='extraction_failed';warning='No supported text-bearing XML entries found.';}
      }
    }else if(extension==='.zip'||mimeType==='application/zip'||mimeType==='application/x-zip-compressed'){
      extractor='safe-zip-text';const list=this.run('unzip',['-Z1',path]);if(!list.ok){status=list.available?'extraction_failed':'extractor_unavailable';warning=list.error;}else{
        const all=list.stdout.split(/\r?\n/).filter(Boolean);if(all.length>MAX_ENTRIES)throw Object.assign(new Error('Archive contains too many entries.'),{status:413});
        const unsafe=all.filter((entry)=>!safeEntry(entry));if(unsafe.length)throw Object.assign(new Error('Archive contains unsafe paths.'),{status:400});
        const selected=all.filter((entry)=>TEXT_EXTENSIONS.has(extname(entry).toLowerCase())).slice(0,250);const parts=[];let total=0;
        for(const entry of selected){const result=this.run('unzip',['-p',path,entry],{maxBuffer:MAX_ENTRY});if(!result.ok)continue;total+=Buffer.byteLength(result.stdout);if(total>MAX_TEXT)break;parts.push(`\n--- ${entry} ---\n${result.stdout}`);}
        text=parts.join('\n').trim();metadata={entries:all.length,textEntries:selected.length};if(!text){status='indexed_metadata';warning='Archive inventory stored; no supported text entries extracted.';}
      }
    }else if(IMAGE_EXTENSIONS.has(extension)||mimeType.startsWith('image/')){
      extractor='tesseract-ocr';const ocr=this.run('tesseract',[path,'stdout']);
      if(ocr.ok)text=ocr.stdout;else{status=ocr.available?'extraction_failed':'extractor_unavailable';warning=ocr.error;}
      // OCR reads text PRINTED IN an image. A photograph with no printed text extracted nothing
      // and was reported `complete` with empty text — indistinguishable from "nothing is there".
      // The fallback below (`D-0651`) only fires when OCR itself found no text, whether it ran
      // and came up empty or could not run at all — the end state ("no text yet") is the same.
      if(!text.trim()&&this.captionImpl){
        const caption=await this.captionImpl({bytes,mimeType});
        if(caption?.configured&&caption.text){
          text=caption.text;extractor=ocr.ok?'tesseract-ocr+vision-caption':'vision-caption';status='complete';warning=null;
          metadata.caption={model:caption.model,providerId:caption.providerId};
        }else if(caption?.configured&&caption.failed){
          status='caption_failed';
          const ocrNote=ocr.ok?'No text found by OCR.':String(warning??'').replace(/\.?$/,'.');
          warning=`${ocrNote} Caption attempt failed: ${(caption.failures??[]).map((item)=>item.error).join('; ')||'unknown error'}`;
        }else if(ocr.ok){
          status='caption_required';
          warning=caption?.reason??'No text found by OCR. Configure a vision-capable provider (Settings → Providers) for a caption fallback.';
        }
      }
    }else if(MEDIA_EXTENSIONS.has(extension)||mimeType.startsWith('audio/')||mimeType.startsWith('video/')){
      extractor='ffprobe';const result=this.run('ffprobe',['-v','error','-show_format','-show_streams','-of','json',path]);
      if(result.ok){
        metadata.media=JSON.parse(result.stdout);
        // Same product this metadata step already trusts: `noesar-voice-hear`, reached the
        // identical way the live microphone reaches it (`voice-engine.mjs`'s own `transcribe`),
        // so a second transcription path with its own quality judgment never has to exist.
        const routing=this.routingImpl();
        const configured=routing?.[VoiceJob.TRANSCRIBE];
        if(!configured?.endpoint){
          status='transcription_required';
          warning='Media metadata indexed. Configure a local speech tool or explicitly approved multimodal provider for transcription.';
        }else{
          try{
            const heard=await this.transcribeImpl({audio:bytes,filename:safeName,mimeType,routing,fetchImpl:this.fetchImpl});
            metadata.transcription={model:heard.model,dropped:Boolean(heard.reason)};
            if(heard.heardSomething){
              text=heard.text;extractor='ffprobe+voice-engine';status='complete';
            }else{
              status='transcription_empty';
              warning=heard.reason==='repetition'
                ?'Media metadata indexed. The transcription model produced only a repetition loop; discarded.'
                :'Media metadata indexed. No speech was detected.';
            }
          }catch(error){
            if(!(error instanceof VoiceEngineError))throw error;
            status='transcription_failed';
            warning=`Media metadata indexed. Transcription failed: ${error.reason}`;
          }
        }
      }else{status=result.available?'metadata_failed':'extractor_unavailable';warning=result.error;}
    }else{status='extractor_required';warning='No extractor is registered for this file type.';}
    if(Buffer.byteLength(text)>MAX_TEXT)text=Buffer.from(text).subarray(0,MAX_TEXT).toString('utf8');
    // The DECLARED type is what is reported back, with the detected one beside it in metadata:
    // the caller said something, and rewriting their statement in the record would hide the very
    // disagreement `typeMismatch` exists to surface.
    return{blobId:id,blobPath:path,storedName:safeName,byteLength:bytes.length,sha256:sha256(bytes),mimeType:declaredMime,extension:declaredExtension,detectedType:detected,text,status,extractor,metadata,warning};
  }
}
