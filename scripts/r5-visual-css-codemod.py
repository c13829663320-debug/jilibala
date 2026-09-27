#!/usr/bin/env python3
"""R5 视觉品牌域 CSS 收敛 codemod：把硬编码 hex 替换为 design token var()。

只处理 apps/web/src 下的 .css 文件（design-tokens.css 除外，它定义 token）。
保留 rgba() 不动作。
"""
import re, pathlib

ROOT = pathlib.Path('/home/user/Doubao/chats/38440437530857986/r5-visual-wt/apps/web/src')

# 精确映射（小写 hex -> token）。顺序很重要：长 hex 先匹配。
MAP = [
    ('#ffd60a', 'var(--color-brand-yellow-alt)'),
    ('#ffd600', 'var(--color-brand-yellow)'),
    ('#4fb3a5', 'var(--color-brand-teal)'),
    ('#20a486', 'var(--color-brand-teal-dark)'),
    ('#0a0a0a', 'var(--bg)'),
    ('#0f0f0f', 'var(--s1)'),
    ('#141414', 'var(--s2)'),
    ('#1a1a1a', 'var(--s3)'),
    ('#212121', 'var(--s4)'),
]

# 词边界：hex 后面不能跟 hex 字符，避免 #4fb3a5xx 截断
pat = re.compile(r'(?<![0-9a-fA-F])(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8}))(?![0-9a-fA-F])')

def repl(m):
    hexv = m.group(1).lower()
    for src, dst in MAP:
        if hexv == src:
            return dst
    return m.group(1)

changed_files = []
total_subs = 0
for css in sorted(ROOT.rglob('*.css')):
    if css.name == 'design-tokens.css':
        continue
    text = css.read_text(encoding='utf-8')
    new, n = pat.subn(repl, text)
    if n > 0:
        css.write_text(new, encoding='utf-8')
        changed_files.append((str(css.relative_to(ROOT)), n))
        total_subs += n

for f, n in changed_files:
    print(f'{n:3d}  {f}')
print(f'---\n{len(changed_files)} files, {total_subs} substitutions')
