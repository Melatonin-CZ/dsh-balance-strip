// 把发布元数据里的 OWNER 一次性替换成你的 GitHub 用户名。
//   node scripts/configure.mjs <github-user>
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const owner = process.argv[2]

if (!owner || !/^[A-Za-z0-9-]+$/.test(owner)) {
  console.error('usage: node scripts/configure.mjs <github-user>')
  process.exit(1)
}

function rewrite(relative, replacements) {
  const path = join(root, relative)
  let text = readFileSync(path, 'utf8')
  for (const [from, to] of replacements) text = text.split(from).join(to)
  writeFileSync(path, text, 'utf8')
  console.log('updated', relative)
}

rewrite('package.json', [
  ['"author": "OWNER"', `"author": "${owner}"`],
  ['github.com/OWNER/', `github.com/${owner}/`],
])

rewrite('LICENSE', [['Copyright (c) 2026 OWNER', `Copyright (c) 2026 ${owner}`]])

rewrite('README.md', [
  ['github.com/OWNER/', `github.com/${owner}/`],
  ['raw.githubusercontent.com/OWNER/', `raw.githubusercontent.com/${owner}/`],
])

rewrite('docs/PUBLISH.md', [
  ['github.com/OWNER/', `github.com/${owner}/`],
  ['<owner>__dsh-balance-strip.yml', `${owner}__dsh-balance-strip.yml`],
  ['name: OWNER/dsh-balance-strip', `name: ${owner}/dsh-balance-strip`],
  ['<your-github-user>', owner],
])

console.log(`\nowner → ${owner}\n现在可以： git init && git add -A && git commit -m "feat: dsh-balance-strip v0.4.0"`)
