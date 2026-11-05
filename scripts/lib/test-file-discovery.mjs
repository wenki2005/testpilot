// List native Node test files after feature-based organization. Never runs them.
import {readdirSync} from 'node:fs';
import path from 'node:path';
export function discoverTestFiles(root){
 const walk=directory=>readdirSync(directory,{withFileTypes:true}).filter(e=>!e.isSymbolicLink()).flatMap(e=>{
  const file=path.join(directory,e.name);
  return e.isDirectory()?walk(file):e.isFile()&&/(?:\.test|\.integration)\.mjs$/.test(e.name)?[file]:[];
 });
 return walk(path.join(root,'tests')).map(file=>path.relative(root,file).replaceAll('\\','/')).sort();
}
