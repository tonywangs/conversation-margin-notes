import {spawnSync} from 'node:child_process';
import {mkdir,writeFile,readdir,stat,readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');process.chdir(root);
await mkdir('results',{recursive:true});
const started=performance.now(),test=spawnSync(process.execPath,['--test','tests/core.test.mjs','tests/drafts.test.mjs'],{encoding:'utf8'});
let log=test.stdout+test.stderr;process.stdout.write(log);
if(test.status!==0){await writeFile('results/tests.log',log);process.exit(test.status||1);}
try {
  const secure=spawnSync(process.execPath,['tests/secure-browser.mjs'],{encoding:'utf8',timeout:180000});
  log+=secure.stdout+secure.stderr;process.stdout.write(secure.stdout+secure.stderr);
  if(secure.status!==0)throw new Error('Production protected-editor verification failed.');
  const {draftModelSuite}=await import('./drafts-model.mjs');const draftModel=await draftModelSuite();
  await writeFile('results/drafts-model.json',JSON.stringify(draftModel,null,2)+'\n');
  const {browserSuite}=await import('./browser.mjs');const browser=await browserSuite();
  browser.scope='Historical in-page UI regression with a test-only worker; production editor evidence is results/secure-verification.json and results/live-verification.json.';
  const drafts=browser.drafts;delete browser.drafts;await writeFile('results/drafts-browser.json',JSON.stringify(drafts,null,2)+'\n');
  const mutations=browser.mutations;delete browser.mutations;
  const dynamic=browser.dynamic;delete browser.dynamic;
  const navigation=browser.navigation;delete browser.navigation;
  if(navigation.sequences.cases!==256)throw new Error('Full verification requires 256 navigation sequences; unset MARGIN_NAV_TRIALS.');
  await writeFile('results/navigation.json',JSON.stringify(navigation,null,2)+'\n');
  await writeFile('results/dynamic.json',JSON.stringify(dynamic,null,2)+'\n');
  await writeFile('results/mutations.json',JSON.stringify(mutations,null,2)+'\n');
  const files=[];
  async function walk(dir){for(const name of (await readdir(dir)).sort()){if(['.git','.agents','.codex','node_modules','.tmp'].includes(name))continue;const p=path.join(dir,name),s=await stat(p);if(s.isDirectory())await walk(p);else{assertLimit(s.size<=10485760,`${p} exceeds 10 MiB`);files.push({path:path.relative(root,p),bytes:s.size});}}}
  const assertLimit=(ok,msg)=>{if(!ok)throw new Error(msg);};
  await walk(root);assertLimit(files.length<=1000,'More than 1,000 files');assertLimit(files.reduce((n,f)=>n+f.bytes,0)<=33554432,'Tree exceeds 32 MiB');
  const extensionFiles=files.filter(f=>f.path.startsWith('extension/'));
  const hashes={};for(const file of files.filter(f=>/^(extension|tests|fixtures)\//.test(f.path)))hashes[file.path]=createHash('sha256').update(await readFile(file.path)).digest('hex');
  const report={verified_at:new Date().toISOString(),runtime_ms:Math.round(performance.now()-started),node:process.version,unit_tests:10,...browser,drafts_summary:{modelCases:draftModel.cases,seed:draftModel.seed,counts:draftModel.counts,browser:drafts},navigation_summary:{cases:navigation.sequences.cases,seed:navigation.sequences.seed,counts:navigation.sequences.counts,anchorChecks:navigation.sequences.anchorChecks,checks:navigation.checks,delayedReadSequences:navigation.delayedReadSequences,metrics:navigation.metrics,finalMetrics:navigation.finalMetrics,dom:navigation.dom},dynamic_summary:{seed:dynamic.sequences.seed,cases:dynamic.sequences.cases,counts:dynamic.sequences.counts,intermediateChecks:dynamic.sequences.intermediateChecks,sequenceMetrics:dynamic.sequenceMetrics,limits:dynamic.limits},mutation_summary:{seed:mutations.seed,cases:mutations.cases,counts:mutations.counts,statuses:mutations.statuses,negative:mutations.negative},artifacts:{extensionBytes:extensionFiles.reduce((n,f)=>n+f.bytes,0),extensionFiles,treeFiles:files.length,treeBytes:files.reduce((n,f)=>n+f.bytes,0),note:'Final artifact sizes including this report and test log; node_modules, git, agent metadata and .tmp excluded.'},sha256:hashes};
  await writeFile('results/verification.json',JSON.stringify(report,null,2)+'\n');
  log+=`\nDraft model cases: ${draftModel.cases}\nDraft browser groups: ${drafts.checks.length}\nBrowser checks: ${browser.checks.length} passed\nChromium: ${browser.browser}\nMutation cases: ${mutations.cases}\nInstalled navigation sequences: ${navigation.sequences.cases}\nInstalled dynamic sequences: ${dynamic.sequences.cases}\nIntermediate anchor checks: ${dynamic.sequences.intermediateChecks}\nDOM negatives: ${mutations.negative.length}\nRuntime: ${report.runtime_ms} ms\n`;
  process.stdout.write(log.slice(test.stdout.length+test.stderr.length));await writeFile('results/tests.log',log);
  // Reach a fixed point for this report's own decimal byte count, then enforce
  // limits on the final artifact tree rather than the previous report's size.
  for(let i=0;i<5;i++) {
    files.length=0;await walk(root);
    const total=files.reduce((n,f)=>n+f.bytes,0);
    assertLimit(files.length<=1000,'More than 1,000 files');assertLimit(total<=33554432,'Tree exceeds 32 MiB');
    if(report.artifacts.treeBytes===total && report.artifacts.treeFiles===files.length)break;
    report.artifacts.treeBytes=total;report.artifacts.treeFiles=files.length;
    await writeFile('results/verification.json',JSON.stringify(report,null,2)+'\n');
  }
} catch(error) {log+='\nFAIL: '+error.stack+'\n';await writeFile('results/tests.log',log);console.error(error);process.exitCode=1;}
