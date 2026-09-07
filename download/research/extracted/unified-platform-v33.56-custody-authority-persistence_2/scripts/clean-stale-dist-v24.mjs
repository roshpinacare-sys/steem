import { existsSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root=resolve('.');
const removed=[];
function walk(directory){
  if(!existsSync(directory))return [];
  const out=[];
  for(const entry of readdirSync(directory,{withFileTypes:true})){
    const path=join(directory,entry.name);
    if(entry.isDirectory())out.push(...walk(path)); else out.push(path);
  }
  return out;
}
for(const area of ['src','tests']){
  const compiled=join(root,'dist',area);
  for(const path of walk(compiled)){
    const rel=relative(compiled,path).replace(/\.(?:js|d\.ts|js\.map|d\.ts\.map)$/,'');
    const source=join(root,area,`${rel}.ts`);
    if(!existsSync(source)){
      rmSync(path,{force:true}); removed.push(relative(root,path));
    }
  }
}
mkdirSync(join(root,'evidence','generated'),{recursive:true});
writeFileSync(join(root,'evidence','generated','V24_STALE_DIST_CLEANUP.json'),JSON.stringify({version:'24.0',status:'completed',removed},null,2)+'\n');
