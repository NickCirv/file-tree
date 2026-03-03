#!/usr/bin/env node

import { readdirSync, statSync, writeFileSync } from 'fs';
import { resolve, join, basename, extname, relative } from 'path';

// ANSI colors
const c = {
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  white: (s) => `\x1b[37m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  reset: '\x1b[0m',
};

// ── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    path: '.',
    depth: Infinity,
    ignore: ['node_modules', '.git'],
    include: [],
    dirsOnly: false,
    filesOnly: false,
    hidden: false,
    size: false,
    count: false,
    format: 'text',
    output: null,
    sort: 'name',
    maxFiles: 1000,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => {
      if (i + 1 >= args.length) { console.error(`Missing value for ${a}`); process.exit(1); }
      return args[++i];
    };
    if (a === '--depth' || a === '-d') {
      const v = parseInt(next(), 10);
      if (isNaN(v) || v < 0) { console.error('--depth must be a non-negative integer'); process.exit(1); }
      opts.depth = v;
    } else if (a === '--ignore') {
      opts.ignore = next().split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '--include') {
      opts.include = next().split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '--dirs-only') {
      opts.dirsOnly = true;
    } else if (a === '--files-only') {
      opts.filesOnly = true;
    } else if (a === '--hidden') {
      opts.hidden = true;
    } else if (a === '--size' || a === '-s') {
      opts.size = true;
    } else if (a === '--count' || a === '-c') {
      opts.count = true;
    } else if (a === '--format' || a === '-f') {
      const v = next();
      if (!['text', 'json', 'markdown', 'html'].includes(v)) {
        console.error(`--format must be one of: text, json, markdown, html`);
        process.exit(1);
      }
      opts.format = v;
    } else if (a === '--output' || a === '-o') {
      opts.output = next();
    } else if (a === '--sort') {
      const v = next();
      if (!['name', 'size', 'date'].includes(v)) {
        console.error(`--sort must be one of: name, size, date`);
        process.exit(1);
      }
      opts.sort = v;
    } else if (a === '--max-files') {
      const v = parseInt(next(), 10);
      if (isNaN(v) || v < 1) { console.error('--max-files must be a positive integer'); process.exit(1); }
      opts.maxFiles = v;
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else if (a === '--version' || a === '-v') {
      console.log('1.0.0');
      process.exit(0);
    } else if (!a.startsWith('-')) {
      opts.path = a;
    } else {
      console.error(`Unknown option: ${a}. Use --help for usage.`);
      process.exit(1);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`
file-tree (ftree) — Beautiful directory trees

USAGE
  ftree [path] [options]

OPTIONS
  --depth <n>           Limit depth (default: unlimited)
  --ignore <patterns>   Comma-separated ignore patterns (default: node_modules,.git)
  --include <patterns>  Only show files matching patterns (e.g. *.js,*.ts)
  --dirs-only           Only show directories
  --files-only          Only show files (no directory lines)
  --hidden              Include hidden files/dirs (starting with .)
  --size                Show file sizes
  --count               Show file/dir count summary at bottom
  --format <fmt>        Output format: text|json|markdown|html (default: text)
  --output <file>       Save output to file
  --sort <by>           Sort order: name|size|date (default: name)
  --max-files <n>       Stop after N files (default: 1000)
  -h, --help            Show help
  -v, --version         Show version

EXAMPLES
  ftree
  ftree src/ --depth 3
  ftree --ignore "node_modules,dist,.git" --size --count
  ftree --include "*.ts" --format markdown --output tree.md
  ftree --format json | jq .
`);
}

// ── Utilities ────────────────────────────────────────────────────────────────

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function matchGlob(name, pattern) {
  // Simple glob: supports * wildcard
  const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
  return regex.test(name);
}

function matchesIgnore(name, patterns) {
  return patterns.some((p) => matchGlob(name, p) || name === p);
}

function matchesInclude(name, patterns) {
  if (patterns.length === 0) return true;
  return patterns.some((p) => matchGlob(name, p) || name === p);
}

function sortEntries(entries, sortBy) {
  return [...entries].sort((a, b) => {
    // Dirs always first for all sort modes
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    if (sortBy === 'size') return (b.stat?.size ?? 0) - (a.stat?.size ?? 0);
    if (sortBy === 'date') return (b.stat?.mtimeMs ?? 0) - (a.stat?.mtimeMs ?? 0);
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

// ── Tree building ────────────────────────────────────────────────────────────

const PIPE = '│';
const TEE  = '├── ';
const LAST = '└── ';
const CONT = '│   ';
const SPAC = '    ';

function buildTree(dirPath, opts, depth = 0, counter = { files: 0, dirs: 0, stopped: false }) {
  if (counter.stopped) return [];

  let entries;
  try {
    entries = readdirSync(dirPath);
  } catch (err) {
    return [{ name: `[Error: ${err.message}]`, isDir: false, stat: null, children: null }];
  }

  // Gather stat info
  const detailed = entries.map((name) => {
    let stat = null;
    let isDir = false;
    try {
      stat = statSync(join(dirPath, name));
      isDir = stat.isDirectory();
    } catch { /* inaccessible */ }
    return { name, isDir, stat };
  });

  // Filter hidden
  const visible = opts.hidden ? detailed : detailed.filter((e) => !e.name.startsWith('.'));

  // Filter ignored
  const notIgnored = visible.filter((e) => !matchesIgnore(e.name, opts.ignore));

  // Sort
  const sorted = sortEntries(notIgnored, opts.sort);

  const result = [];
  for (const entry of sorted) {
    if (counter.stopped) break;

    const { name, isDir, stat } = entry;

    if (isDir) {
      // Check depth before recursing
      const children = (depth < opts.depth)
        ? buildTree(join(dirPath, name), opts, depth + 1, counter)
        : null;

      if (!opts.filesOnly) {
        counter.dirs++;
        result.push({ name, isDir: true, stat, children });
      } else if (children) {
        // filesOnly: don't show dir node, but still recurse
        result.push(...(children || []));
      }
    } else {
      // Apply --include filter
      if (!matchesInclude(name, opts.include)) continue;
      if (opts.dirsOnly) continue;

      counter.files++;
      if (counter.files > opts.maxFiles) {
        counter.stopped = true;
        result.push({ name: `... (truncated at ${opts.maxFiles} files)`, isDir: false, stat: null, children: null, truncated: true });
        break;
      }
      result.push({ name, isDir: false, stat, children: null });
    }
  }

  return result;
}

// ── Text renderer ────────────────────────────────────────────────────────────

function renderText(nodes, prefix = '', useColor = true) {
  const lines = [];
  const cc = useColor ? c : { cyan: (s) => s, white: (s) => s, gray: (s) => s, bold: (s) => s };

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLast = i === nodes.length - 1;
    const connector = isLast ? LAST : TEE;
    const childPrefix = prefix + (isLast ? SPAC : CONT);

    if (node.isDir) {
      const dirName = cc.cyan(node.name + '/');
      lines.push(prefix + connector + dirName);
      if (node.children && node.children.length > 0) {
        lines.push(...renderText(node.children, childPrefix, useColor));
      }
    } else if (node.truncated) {
      lines.push(prefix + connector + cc.gray(node.name));
    } else {
      let label = cc.white(node.name);
      if (node.stat) {
        const sizeStr = formatSize(node.stat.size);
        label += cc.gray(`  ${sizeStr}`);
      }
      lines.push(prefix + connector + label);
    }
  }
  return lines;
}

// ── JSON renderer ────────────────────────────────────────────────────────────

function renderJSON(nodes) {
  const mapNode = (n) => {
    const obj = {
      name: n.name,
      type: n.isDir ? 'directory' : 'file',
    };
    if (!n.isDir && n.stat) obj.size = n.stat.size;
    if (n.isDir) obj.children = (n.children || []).map(mapNode);
    return obj;
  };
  return JSON.stringify(nodes.map(mapNode), null, 2);
}

// ── Markdown renderer ────────────────────────────────────────────────────────

function renderMarkdown(rootName, nodes) {
  const textLines = [rootName + '/'];
  textLines.push(...renderText(nodes, '', false));
  return '```text\n' + textLines.join('\n') + '\n```';
}

// ── HTML renderer ────────────────────────────────────────────────────────────

function renderHTML(rootName, nodes) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function renderNodes(list) {
    if (!list || list.length === 0) return '';
    const items = list.map((n) => {
      if (n.isDir) {
        return `<li class="ft-dir"><span class="ft-name">${esc(n.name)}/</span>${renderNodes(n.children)}</li>`;
      }
      const sizeAttr = n.stat ? ` data-size="${n.stat.size}"` : '';
      const sizeSpan = n.stat ? ` <span class="ft-size">${esc(formatSize(n.stat.size))}</span>` : '';
      return `<li class="ft-file"${sizeAttr}><span class="ft-name">${esc(n.name)}</span>${sizeSpan}</li>`;
    });
    return `<ul class="ft-tree">${items.join('')}</ul>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(rootName)} — file-tree</title>
<style>
body { font-family: 'Courier New', monospace; background: #1e1e2e; color: #cdd6f4; padding: 2rem; }
.ft-tree { list-style: none; padding-left: 1.5rem; margin: 0; }
.ft-tree > li:first-child { padding-top: 0; }
li { padding: 0.15rem 0; }
.ft-dir > .ft-name { color: #89dceb; font-weight: bold; }
.ft-file > .ft-name { color: #cdd6f4; }
.ft-size { color: #6c7086; font-size: 0.85em; margin-left: 1rem; }
h1 { color: #89dceb; margin-bottom: 1rem; }
</style>
</head>
<body>
<h1>${esc(rootName)}/</h1>
${renderNodes(nodes)}
</body>
</html>`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv);

  let targetPath;
  try {
    targetPath = resolve(opts.path);
    statSync(targetPath); // verify exists
  } catch {
    console.error(`Error: path not found: ${opts.path}`);
    process.exit(1);
  }

  const rootName = basename(targetPath) || targetPath;
  const counter = { files: 0, dirs: 0, stopped: false };
  const nodes = buildTree(targetPath, opts, 0, counter);

  const useColor = opts.format === 'text' && !opts.output && process.stdout.isTTY;

  let output;
  switch (opts.format) {
    case 'json':
      output = renderJSON(nodes);
      break;
    case 'markdown':
      output = renderMarkdown(rootName, nodes);
      break;
    case 'html':
      output = renderHTML(rootName, nodes);
      break;
    default: {
      // text
      const cc = useColor ? c : { cyan: (s) => s, white: (s) => s };
      const header = useColor ? cc.cyan(rootName + '/') : rootName + '/';
      const lines = [header, ...renderText(nodes, '', useColor)];
      if (opts.count) {
        lines.push('');
        lines.push(`${counter.dirs} director${counter.dirs === 1 ? 'y' : 'ies'}, ${counter.files} file${counter.files === 1 ? '' : 's'}`);
      }
      if (counter.stopped) {
        lines.push(useColor ? c.gray(`(stopped at --max-files ${opts.maxFiles})`) : `(stopped at --max-files ${opts.maxFiles})`);
      }
      output = lines.join('\n');
      break;
    }
  }

  if (opts.output) {
    try {
      writeFileSync(opts.output, output + '\n', 'utf8');
      console.log(`Saved to ${opts.output}`);
    } catch (err) {
      console.error(`Error writing output: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.log(output);
  }
}

main();
