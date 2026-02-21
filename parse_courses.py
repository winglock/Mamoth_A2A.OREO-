#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Parse university course listing HTML file line-by-line (memory efficient).
"""

import re
from collections import defaultdict

def main():
    print("Reading file line by line...")
    
    courses = []
    in_script = False
    current_tds = []
    in_td = False
    td_text = ""
    in_thead = False
    
    with open(r'c:\Users\ehdrjs10w\Desktop\mammoth\txt', 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            
            # Track script blocks
            if '<script' in line:
                in_script = True
                continue
            if '</script>' in line:
                in_script = False
                continue
            if in_script:
                continue
            
            # Track thead
            if '<thead>' in line:
                in_thead = True
                continue
            if '</thead>' in line:
                in_thead = False
                continue
            if in_thead:
                continue
            
            # Skip input, a tags, empty lines
            if '<input ' in line or '<a ' in line or '</a>' in line:
                continue
            
            # New row
            if '<tr>' in line:
                current_tds = []
                continue
            
            # End row - process what we have
            if '</tr>' in line:
                if len(current_tds) >= 11:
                    course = {
                        'code': current_tds[0],
                        'name': current_tds[1],
                        'section': current_tds[2],
                        'credits': current_tds[3],
                        'professor': current_tds[4],
                        'room': current_tds[5],
                        'time': current_tds[6],
                        'semester': current_tds[7],
                        'limit': current_tds[8],
                        'enrolled': current_tds[9],
                        'category': current_tds[10],
                    }
                    if course['code'] and course['name']:
                        courses.append(course)
                current_tds = []
                continue
            
            # Start of td
            if '<td' in line:
                # Check if td content is on same line
                m = re.search(r'<td[^>]*>(.*?)(?:</td>)?', line)
                if m:
                    content = m.group(1).strip()
                    content = re.sub(r'<[^>]+>', '', content).strip()  # strip any inner tags
                    if '</td>' in line:
                        current_tds.append(content)
                        in_td = False
                    else:
                        in_td = True
                        td_text = content
                continue
            
            # End td
            if '</td>' in line:
                in_td = False
                current_tds.append(td_text.strip())
                td_text = ""
                continue
            
            # Content inside td
            if in_td:
                clean = re.sub(r'<[^>]+>', '', line).strip()
                if clean:
                    if td_text:
                        td_text += " " + clean
                    else:
                        td_text = clean
            
            if line_num % 10000 == 0:
                print(f"  Processed {line_num} lines, found {len(courses)} courses so far...")
    
    print(f"\nTotal: {len(courses)} courses found")
    
    if not courses:
        print("No courses found!")
        return
    
    def dw(s):
        """Display width for CJK characters."""
        w = 0
        for ch in s:
            if ord(ch) > 0x1100:
                w += 2
            else:
                w += 1
        return w
    
    def pad(s, tw, align='l'):
        """Pad to target width."""
        d = tw - dw(s)
        if d < 0: d = 0
        if align == 'c':
            return ' ' * (d // 2) + s + ' ' * (d - d // 2)
        elif align == 'r':
            return ' ' * d + s
        return s + ' ' * d
    
    headers = ['교과목코드', '교과목명', '분반', '학점', '교수명', '강의실', '수업시간', '셀학기', '제한인원', '수강인원', '이수구분']
    keys = ['code', 'name', 'section', 'credits', 'professor', 'room', 'time', 'semester', 'limit', 'enrolled', 'category']
    center_keys = {'code', 'section', 'credits', 'limit', 'enrolled', 'semester'}
    
    def make_table(clist):
        # Calculate widths
        ws = []
        for h, k in zip(headers, keys):
            mx = max((dw(c.get(k, '')) for c in clist), default=0)
            ws.append(max(dw(h), mx))
        
        lines = []
        lines.append('┌' + '┬'.join('─' * (w+2) for w in ws) + '┐')
        
        hdr = '│'
        for h, w in zip(headers, ws):
            hdr += ' ' + pad(h, w, 'c') + ' │'
        lines.append(hdr)
        lines.append('├' + '┼'.join('─' * (w+2) for w in ws) + '┤')
        
        for c in clist:
            row = '│'
            for k, w in zip(keys, ws):
                v = c.get(k, '')
                a = 'c' if k in center_keys else 'l'
                row += ' ' + pad(v, w, a) + ' │'
            lines.append(row)
        
        lines.append('└' + '┴'.join('─' * (w+2) for w in ws) + '┘')
        return '\n'.join(lines)

    # Write full list
    p1 = r'c:\Users\ehdrjs10w\Desktop\mammoth\수강목록_전체.txt'
    with open(p1, 'w', encoding='utf-8') as f:
        f.write('═' * 120 + '\n')
        f.write('                         2026학년도 1학기 수강 과목 목록\n')
        f.write('═' * 120 + '\n\n')
        f.write(f'총 {len(courses)}개 교과목\n\n')
        f.write(make_table(courses))
        f.write('\n')
    print(f"Written: {p1}")
    
    # Group by category
    by_cat = defaultdict(list)
    for c in courses:
        cat = c.get('category', '') or '미분류'
        by_cat[cat].append(c)
    
    p2 = r'c:\Users\ehdrjs10w\Desktop\mammoth\수강목록_이수구분별.txt'
    with open(p2, 'w', encoding='utf-8') as f:
        f.write('═' * 120 + '\n')
        f.write('                    2026학년도 1학기 수강 과목 목록 (이수구분별)\n')
        f.write('═' * 120 + '\n\n')
        f.write(f'총 {len(courses)}개 교과목\n\n')
        for cat in sorted(by_cat.keys()):
            cl = by_cat[cat]
            f.write(f'\n▶ {cat} ({len(cl)}개)\n')
            f.write('─' * 80 + '\n')
            f.write(make_table(cl))
            f.write('\n\n')
    print(f"Written: {p2}")
    
    print("\n=== 이수구분별 요약 ===")
    for cat in sorted(by_cat.keys()):
        print(f"  {cat}: {len(by_cat[cat])}개")
    print(f"  Total: {len(courses)}개")


if __name__ == '__main__':
    main()
