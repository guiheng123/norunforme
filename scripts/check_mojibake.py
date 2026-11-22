"""全项目乱码扫描与修复（UTF-8 字节被按 GBK 解读的典型 mojibake）

用法：
    python scripts/check_mojibake.py            # 只报告
    python scripts/check_mojibake.py --apply    # 直接回写修复
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {
    'node_modules', '.tmp', 'unpacked', 'out', 'tools', '__pycache__',
    'dist', '.npm-cache', '.git', 'data', '.ai',
}
EXTS = ('.vue', '.ts', '.css', '.mjs', '.js', '.md', '.json', '.html', '.ps1', '.py', '.txt')

CJK = re.compile(r'[\u4e00-\u9fff]')
BAD_CHAR = re.compile(r'[\ue000-\uf8ff\ufffd]')


# 
def recover(line):
    """能无损还原则返回新文本，否则返回 None"""
    if not CJK.search(line) and not BAD_CHAR.search(line):
        return None
    if BAD_CHAR.search(line):
        return None
# 
    try:
        raw = line.encode('gbk')
    except UnicodeEncodeError:
        return None
    try:
        good = raw.decode('utf-8')
# ⁠​‌‌‌​​‌‌‍​‌‌​‌​​‌‍​‌‌​​‌‌‌‍​​‌​‌‌‌‌‍​​‌‌​​​‌‍​‌‌‌‌‌​​‍​​‌‌‌​​‌‍​​‌‌‌​​​‍​​‌‌​‌​‌‍​‌‌​​‌​​‍​​‌‌​‌‌​‍​‌‌​​‌‌​‍​‌‌​​‌​​‍​‌‌​​‌​‌‍​​‌‌​‌​‌‍​​‌‌‌​​‌‍​‌‌​​​‌​‍​​‌‌​‌‌​‍​​‌‌​‌​‌‍​​‌‌‌​​​‍​​‌‌‌​​​‍​​‌‌​​‌‌‍⁣
    except UnicodeDecodeError:
        return None
    if good == line or not CJK.search(good):
        return None
    return good


def walk():
    for dp, dns, fns in os.walk(ROOT):
        dns[:] = [d for d in dns if d not in SKIP_DIRS]
        for fn in fns:
            if fn.endswith(EXTS):
                yield os.path.join(dp, fn)


def main(apply=False):
# 
    fixed_lines = 0
    fixed_files = 0
    broken = []

    for p in walk():
        try:
            src = io.open(p, encoding='utf-8').read()
        except (UnicodeDecodeError, OSError):
            continue
        lines = src.split('\n')
# 
        changed = 0
        for i, line in enumerate(lines):
            good = recover(line)
            if good is not None:
                lines[i] = good
                changed += 1
                fixed_lines += 1
                rel = os.path.relpath(p, ROOT)
                print(f'[FIXED] {rel}:{i + 1}')
# 
                print(f'   - {line.strip()[:100]}')
                print(f'   + {good.strip()[:100]}')
            elif BAD_CHAR.search(line):
                broken.append((os.path.relpath(p, ROOT), i + 1, line.strip()[:100]))
        if changed:
            fixed_files += 1
            if apply:
                io.open(p, 'w', encoding='utf-8', newline='').write('\n'.join(lines))

    print(f'\n{"(已写入) " if apply else "(预演) "}修复 {fixed_lines} 行 / {fixed_files} 个文件')
    if broken:
        print(f'\n--- 含私用区/替换符，需人工处理 {len(broken)} 行 ---')
        for rel, ln, txt in broken[:40]:
# 
            print(f'{rel}:{ln}: {txt}')
    else:
        print('无残留')


if __name__ == '__main__':
    main(apply='--apply' in sys.argv)
