#!/usr/bin/env node
import ts from 'typescript';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootArg = process.argv.indexOf('--root');
const root = path.resolve(rootArg >= 0 ? process.argv[rootArg + 1] : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const sourceRoot = path.join(root, 'src');
const webRoot = path.join(root, 'web', 'src');
const forbiddenDomainLayers = new Set(['adapters', 'storage', 'reporters', 'interfaces', 'bootstrap', 'demo', 'engines', 'orchestration', 'application']);
const filesUnder = directory => !statSync(directory, { throwIfNoEntry: false })?.isDirectory() ? [] : readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(directory, entry.name);
  return entry.isDirectory() ? filesUnder(full) : entry.isFile() && /\.tsx?$/.test(full) ? [full] : [];
});
const sourceFiles = [...filesUnder(sourceRoot), ...filesUnder(webRoot)];
const errors = [];
const modules = new Map();
const resolveLocal = (from, specifier) => {
  if (!specifier.startsWith('.')) return undefined;
  const base = path.resolve(path.dirname(from), specifier);
  // TypeScript projects commonly write runtime imports with the emitted .js
  // suffix. Map those back to their source files before checking the graph.
  const sourceBase = /\.m?js$/i.test(base) ? base.replace(/\.m?js$/i, '') : base;
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.cts`, `${sourceBase}.ts`, `${sourceBase}.tsx`, `${sourceBase}.mts`, `${sourceBase}.cts`, path.join(sourceBase, 'index.ts'), path.join(sourceBase, 'index.tsx')];
  return candidates.find(candidate => statSync(candidate, { throwIfNoEntry: false })?.isFile());
};
const layerOf = file => {
  const relative = path.relative(sourceRoot, file).split(path.sep);
  return relative[0] === '..' ? undefined : relative[0];
};

for (const file of sourceFiles) {
  const text = readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imports = [];
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      const target = resolveLocal(file, specifier);
      const typeOnly = ts.isImportDeclaration(node)
        ? node.importClause?.isTypeOnly === true || Boolean(node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) && node.importClause.namedBindings.elements.length > 0 && node.importClause.namedBindings.elements.every(element => element.isTypeOnly))
        : node.isTypeOnly === true || Boolean(node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every(element => element.isTypeOnly));
      imports.push({ specifier, target, typeOnly });
      const fromLayer = layerOf(file);
      if (fromLayer === 'domain') {
        if (!specifier.startsWith('.')) errors.push(`${path.relative(root, file)} imports external module ${specifier}`);
        else if (!target) errors.push(`${path.relative(root, file)} has unresolved internal import ${specifier}`);
        else if (layerOf(target) !== 'domain') errors.push(`${path.relative(root, file)} imports forbidden layer ${path.relative(sourceRoot, target).replaceAll(path.sep, '/')}`);
      }
      if (fromLayer === 'application' && target && !['domain', 'application'].includes(layerOf(target))) errors.push(`${path.relative(root, file)} imports forbidden layer ${path.relative(sourceRoot, target).replaceAll(path.sep, '/')}`);
      if (file.startsWith(webRoot) && target && !target.startsWith(webRoot) && layerOf(target) !== 'domain') errors.push(`${path.relative(root, file)} imports server module ${specifier}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  modules.set(file, imports);
}

const visiting = new Set();
const visited = new Set();
const stack = [];
const reportedCycles = new Set();
const visitRuntime = file => {
  if (visiting.has(file)) {
    const cycle = [...stack.slice(stack.indexOf(file)), file].map(item => path.relative(root, item)).join(' -> ');
    if (!reportedCycles.has(cycle)) { reportedCycles.add(cycle); errors.push(`runtime import cycle: ${cycle}`); }
    return;
  }
  if (visited.has(file)) return;
  visiting.add(file); stack.push(file);
  for (const item of modules.get(file) ?? []) if (!item.typeOnly && item.target) visitRuntime(item.target);
  stack.pop(); visiting.delete(file); visited.add(file);
};
for (const file of sourceFiles) visitRuntime(file);
if (errors.length) {
  console.error(`Architecture check failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else console.log(`Architecture check passed: ${sourceFiles.length} source modules; domain boundaries and runtime import graph are valid.`);
