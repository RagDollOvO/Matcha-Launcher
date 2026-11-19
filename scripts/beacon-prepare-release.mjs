import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { checkProject } from '../backend/releases.mjs';
const [buildDirectory, packageDirectory, licenseFile] = process.argv.slice(2);
if (!buildDirectory || !packageDirectory) throw new Error('Usage: node beacon-prepare-release.mjs BUILD_DIR NEW_PACKAGE_DIR [LICENSE_FILE]');
const input=path.resolve(buildDirectory), out=path.resolve(packageDirectory);
const read=async name=>JSON.parse((await fs.readFile(path.join(input,name),'utf8')).replace(/^\uFEFF/,''));
const hash=data=>createHash('sha256').update(data).digest('hex');
const result=await read('output/result.json'), pins=await read('build-inputs.json');
if(result.status!=='built' || result.isolation!=='windows-sandbox') throw new Error('Completed Windows Sandbox build required');
// Re-read exact inputs and both outputs. Guest-provided hash claims are unused.
for(const entry of pins.inputs) if(hash(await fs.readFile(path.join(input,'input',entry.path)))!==entry.sha256) throw new Error('Build input changed');
const a=await fs.readFile(path.join(input,'output/plugin-a.dll')), b=await fs.readFile(path.join(input,'output/plugin-b.dll'));
if(!a.equals(b)) throw new Error('Rebuild differs byte-for-byte');
const checks=await checkProject(path.join(input,'input'));
if(checks.status==='needs_changes') throw new Error(JSON.stringify(checks));
const manifest=await read('input/manifest.json');
await fs.mkdir(out);
await fs.writeFile(path.join(out,'plugin.dll'),a,{flag:'wx'});
await fs.copyFile(path.join(input,'input/manifest.json'),path.join(out,'manifest.json'),fs.constants.COPYFILE_EXCL);
// An explicit license override supports licensing an earlier build snapshot.
await fs.copyFile(licenseFile ? path.resolve(licenseFile) : path.join(input,'input/LICENSE'),path.join(out,'license.txt'),fs.constants.COPYFILE_EXCL);
const evidence={schemaVersion:1, kind:'beacon-build-comparison', checkedAt:new Date().toISOString(),
  sourceCommit:manifest.developer.source.commit, sourceSnapshot:pins.inputs,
  buildInputRecordSha256:hash(await fs.readFile(path.join(input,'build-inputs.json'))),
  compiler:result.compiler, flags:result.flags, isolation:'windows-sandbox',
  comparison:'byte-for-byte-equal', size:a.length, artifactSha256:hash(a), independentReproduction:'not-run'};
await fs.writeFile(path.join(out,'build-evidence.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
const files=[];
for(const name of (await fs.readdir(out)).sort()) { const bytes=await fs.readFile(path.join(out,name)); files.push({path:name,size:bytes.length,sha256:hash(bytes)}); }
const release={schemaVersion:1,id:manifest.id,version:manifest.version,files,
  source:{...manifest.developer.source,license:manifest.developer.license},
  build:{status:'repeated-byte-identical',isolation:'windows-sandbox',independentReproduction:'not-run',evidence:'build-evidence.json'},
  behaviorReview:{status:'pending'},compatibility:{architecture:'x86',apiVersion:1,gameBuilds:manifest.developer.gameBuilds}};
await fs.writeFile(path.join(out,'release.json'),JSON.stringify(release,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({packageDirectory:out,checks,comparison:evidence.comparison,artifactSha256:evidence.artifactSha256},null,2));
