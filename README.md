<div align="center">

# file-tree

**ASCII directory trees with filtering, sorting, and export — smarter than `tree`**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue?labelColor=0B0A09)](LICENSE)
![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?labelColor=0B0A09)
![Node >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen?labelColor=0B0A09)

</div>

## Install

```bash
npx github:NickCirv/file-tree [path] [options]
```

Or install globally:

```bash
npm install -g github:NickCirv/file-tree
```

## Usage

```bash
ftree                                              # current directory
ftree src/ --depth 3 --size --count               # scoped, with sizes + summary
ftree --include "*.ts,*.tsx" --format markdown     # TypeScript files → markdown
ftree --format json | jq '.[] | .name'            # JSON output for scripting
```

| Flag | Description | Default |
|------|-------------|---------|
| `--depth <n>` | Limit tree depth | unlimited |
| `--ignore <patterns>` | Comma-separated ignore list | `node_modules,.git` |
| `--include <patterns>` | Only show matching files (e.g. `*.ts`) | all |
| `--dirs-only` | Only show directories | false |
| `--files-only` | Only show files, no dir lines | false |
| `--hidden` | Include hidden files/dirs | false |
| `--size` | Show file sizes | false |
| `--count` | Show file/dir count at bottom | false |
| `--format <fmt>` | Output format: `text`, `json`, `markdown`, `html` | `text` |
| `--output <file>` | Save output to file | stdout |
| `--sort <by>` | Sort by: `name`, `size`, `date` | `name` |
| `--max-files <n>` | Stop after N files | `1000` |

## What it does

Recursively walks a directory and renders the structure as an ANSI-coloured tree (cyan dirs, white files). Supports four output formats — text, JSON, Markdown, and a standalone dark-theme HTML page — so you can paste trees directly into docs or pipe them to `jq`. Glob-based `--include`/`--ignore` patterns let you filter noise without scripting, and `--sort size|date` surfaces the biggest or most recently changed files first.

---
<sub>Zero dependencies · Node >=18 · MIT · by <a href="https://github.com/NickCirv">NickCirv</a></sub>
