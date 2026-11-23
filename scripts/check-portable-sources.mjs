import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { localGuideLinks } from './portable-docs.mjs';

const entries = ['backend/desktop/host.mjs', 'backend/community/recover.mjs',
  'backend/pi/platform-extension.mjs', 'backend/pi/local-extension.mjs'];
const relativeTo = (file, ref) => path.posix.join(path.posix.dirname(file), ref);

function mappedSource(files, dest, from) {
  const exact = files.get(dest);
  if (exact) return exact;
  for (const [prefix, dir] of files) {
    if (prefix.endsWith('/') && dest.startsWith(prefix)) return path.join(dir, dest.slice(prefix.length));
  }
  throw new Error(`便携包缺少 ${dest}${from ? `（${from} 引用）` : ''}`);
}

function moduleRefs(file, content) {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const refs = [];
  const add = spec => {
    if (spec && ts.isStringLiteralLike(spec) && /^\.\.?\//.test(spec.text)) refs.push(spec.text);
  };
  const visit = node => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return refs;
}

export async function checkPortableSources(resources, { copies, generated }) {
  const modules = new Set();
  async function visitModule(file, from) {
    if (modules.has(file)) return;
    modules.add(file);
    const source = mappedSource(resources, file, from);
    if (!/\.[cm]?js$/i.test(file)) {
      await fs.access(source);
      return;
    }
    const content = await fs.readFile(source, 'utf8');
    for (const ref of moduleRefs(file, content)) await visitModule(relativeTo(file, ref), file);
  }
  for (const entry of entries) await visitModule(entry);
  for (const file of ['backend/servers/matcha-steam-friends.exe', 'docs/platform/skeeto-modules.json'])
    mappedSource(resources, file);

  const docs = new Map([...resources, ...copies]);
  const checked = new Set();
  async function visitGuide(file, from) {
    if (checked.has(file)) return;
    checked.add(file);
    let markdown = generated.get(file);
    if (markdown === undefined) {
      const source = mappedSource(docs, file, from);
      if (!file.endsWith('.md')) { await fs.access(source); return; }
      markdown = await fs.readFile(source, 'utf8');
    }
    for (const ref of localGuideLinks(markdown)) {
      if (ref.startsWith('/')) throw new Error(`随包手册请用相对链接：${file} → ${ref}`);
      await visitGuide(relativeTo(file, decodeURI(ref)), file);
    }
  }
  const roots = [...generated.keys(), ...[...copies.keys()].filter(file => file.endsWith('.md'))];
  for (const file of roots) await visitGuide(file);
  return { backendFiles: modules.size, guideTargets: checked.size };
}
