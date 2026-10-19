// Optional live test: current public App source, production disk/decryption path, isolated temporary data.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),{EventEmitter}=require('node:events'),{execFile}=require('node:child_process'),exec=require('node:util').promisify(execFile),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),file=path.join(root,'main.js'),req=createRequire(file);
(async()=>{
 const temp=await fsp.mkdtemp(path.join(os.tmpdir(),'hongguo-live-main-'));const handlers={},app=new EventEmitter(),store=req('./src/store'),native=req('./src/native/hongguo');let fetchedSource=null;
 Object.assign(app,{getVersion:()=> 'live',getPath:name=>name==='downloads'?path.join(temp,'downloads'):temp,commandLine:{appendSwitch(){}},requestSingleInstanceLock:()=>true,whenReady:()=>({then(){}})});store.init(path.join(temp,'data.json'));
 const electron={app,ipcMain:{handle:(name,fn)=>{handlers[name]=fn;}},protocol:{registerSchemesAsPrivileged(){}}};
 const context=vm.createContext({require:name=>name==='electron'?electron:name==='./src/native/hongguo'?{...native,fetchPlayUrlSingle:async(...args)=>{const result=await native.fetchPlayUrlSingle(...args);fetchedSource=result.source;return result;}}:req(name),__dirname:root,process,Buffer,URL,Response,Request,Headers,AbortController,setTimeout,clearTimeout,console:{log(){},warn(){},error(){}}});
 try{
 vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:file});
 const result=await handlers['prepare-online-play']({}, {disk:true,seriesId:'7516411117833292825',vid:'7516512118569454654',vidIndex:4,quality:'1080p',requestId:'live-app-check'});
 if(!result.success)throw Error(result.error);
 const entry=vm.runInContext("onlineCache.get(playbackCache.cacheKey('7516512118569454654','1080p'))",context);
 if(fetchedSource!=='app'||entry.width!==1080||entry.height!==1920)throw Error('Unexpected source or dimensions');
 await exec(path.join(root,'build/ffmpeg/linux-x64/ffmpeg'),['-v','error','-i',entry.filePath,'-frames:v','1','-an','-f','null','-'],{timeout:20000,maxBuffer:65536});
 console.log(JSON.stringify({passed:true,pipeline:'production prepare-online-play',source:fetchedSource,width:entry.width,height:entry.height,codec:entry.codec,bytes:entry.size,clearCachedVideoDecoded:true}));
 await handlers['release-online-play']({}, {streamId:result.streamId});
 }finally{context.clearOnlineCache?.();await fsp.rm(temp,{recursive:true,force:true});}
})().catch(e=>{console.log(JSON.stringify({passed:false,error:e.code||e.message}));process.exitCode=1});
