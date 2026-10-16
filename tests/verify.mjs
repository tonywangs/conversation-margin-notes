import {spawnSync} from 'node:child_process';
import {mkdir,writeFile,readdir,stat,readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');process.chdir(root);
await mkdir('results',{recursive:true});
const started=performance.now(),test=spawnSync(process.execPath,['--test','tests/core.test.mjs'],{encoding:'utf8'});
let log=test.stdout+test.stderr;process.stdout.write(log);
if(test.status!==0){await writeFile('results/tests.log',log);process.exit(test.status||1);}
try {
  const {browserSuite}=await import('./browser.mjs');const browser=await browserSuite();
  const mutations=browser.mutations;delete browser.mutations;
  await writeFile('results/mutations.json',JSON.stringify(mutations,null,2)+'\n');
  const files=[];
  async function walk(dir){for(const name of (await readdir(dir)).sort()){if(['.git','.agents','.codex','node_modules','.tmp'].includes(name))continue;const p=path.join(dir,name),s=await stat(p);if(s.isDirectory())await walk(p);else{assertLimit(s.size<=10485760,`${p} exceeds 10 MiB`);files.push({path:path.relative(root,p),bytes:s.size});}}}
  const assertLimit=(ok,msg)=>{if(!ok)throw new Error(msg);};
  await walk(root);assertLimit(files.length<=1000,'More than 1,000 files');assertLimit(files.reduce((n,f)=>n+f.bytes,0)<=33554432,'Tree exceeds 32 MiB');
  const extensionFiles=files.filter(f=>f.path.startsWith('extension/'));
  const hashes={};for(const file of files.filter(f=>/^(extension|tests|fixtures)\//.test(f.path)))hashes[file.path]=createHash('sha256').update(await readFile(file.path)).digest('hex');
  const report={verified_at:new Date().toISOString(),runtime_ms:Math.round(performance.now()-started),node:process.version,unit_tests:6,...browser,mutation_summary:{seed:mutations.seed,cases:mutations.cases,counts:mutations.counts,statuses:mutations.statuses,negative:mutations.negative},artifacts:{extensionBytes:extensionFiles.reduce((n,f)=>n+f.bytes,0),extensionFiles,treeFiles:files.length,treeBytes:files.reduce((n,f)=>n+f.bytes,0),note:'Tree counts are measured before replacing this report and test log; node_modules and git metadata excluded.'},sha256:hashes};
  await writeFile('results/verification.json',JSON.stringify(report,null,2)+'\n');
  log+=`\nBrowser checks: ${browser.checks.length} passed\nChromium: ${browser.browser}\nMutation cases: ${mutations.cases}\nDOM negatives: ${mutations.negative.length}\nRuntime: ${report.runtime_ms} ms\n`;
  process.stdout.write(log.slice(test.stdout.length+test.stderr.length));await writeFile('results/tests.log',log);
} catch(error) {log+='\nFAIL: '+error.stack+'\n';await writeFile('results/tests.log',log);console.error(error);process.exitCode=1;}
