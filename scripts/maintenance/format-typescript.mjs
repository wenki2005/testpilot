#!/usr/bin/env node
/** Format dense source TypeScript without editing symbols or literals.
 * Default: report only. --write: update files whose canonical AST is unchanged.
 * JSX text must remain identical. Excludes generated JavaScript and runtime data.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const write=process.argv.includes('--write');
const printer=ts.createPrinter({newLine:ts.NewLineKind.LineFeed,removeComments:false});
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).filter(e=>!e.isSymbolicLink()).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):e.isFile()&&/\.tsx?$/.test(e.name)?[path.join(dir,e.name)]:[]);
const candidates=['src','web/src'].flatMap(dir=>walk(path.join(root,dir))).filter(file=>!file.endsWith('.d.ts'));
const changes=[],skipped=[];
function signature(node){
 if(ts.isParenthesizedExpression(node)||ts.isParenthesizedTypeNode(node))return signature(node.expression??node.type);
 const children=[];ts.forEachChild(node,child=>{children.push(signature(child));});
 return [node.kind,ts.isVariableDeclarationList(node)?node.flags&ts.NodeFlags.BlockScoped:null,!ts.isSourceFile(node)&&typeof node.text==='string'?node.text:null,node.rawText??null,children];
}
for(const file of candidates){const before=fs.readFileSync(file,'utf8');if(!before.split(/\r?\n/).some(line=>line.length>180))continue;
 const kind=file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS;
 const ast=ts.createSourceFile(file,before,ts.ScriptTarget.Latest,true,kind);
 if(ast.parseDiagnostics.length)throw Error('Cannot format a file with parse errors: '+path.relative(root,file));
 let after=printer.printFile(ast),reparsed;
 for(let pass=0;pass<6;pass++){reparsed=ts.createSourceFile(file,after,ts.ScriptTarget.Latest,true,kind);const next=printer.printFile(reparsed);if(next===after)break;after=next;}
 reparsed=ts.createSourceFile(file,after,ts.ScriptTarget.Latest,true,kind);
 if(reparsed.parseDiagnostics.length||printer.printFile(reparsed)!==after||JSON.stringify(signature(ast))!==JSON.stringify(signature(reparsed))){skipped.push(path.relative(root,file).replaceAll('\\','/'));continue;}
 if(before!==after){changes.push(path.relative(root,file).replaceAll('\\','/'));if(write)fs.writeFileSync(file,after);}
}
console.log(JSON.stringify({mode:write?'write':'preview',files:changes.length,changed:changes,skipped}));
