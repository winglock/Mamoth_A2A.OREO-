const fs = require('fs');

const inputPath = String.raw`c:\Users\ehdrjs10w\Desktop\mammoth\txt`;
const outputPath = String.raw`c:\Users\ehdrjs10w\Desktop\mammoth\수강목록_전체.txt`;
const outputPath2 = String.raw`c:\Users\ehdrjs10w\Desktop\mammoth\수강목록_이수구분별.txt`;

console.log('Reading file...');
let content = fs.readFileSync(inputPath, 'utf-8');
console.log(`File size: ${content.length} chars`);

// Remove script blocks
content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

// Remove input tags
content = content.replace(/<input[^>]*\/?>/gi, '');

// Remove <a> tags and content
content = content.replace(/<a[^>]*>[\s\S]*?<\/a>/gi, '');

// Remove thead sections
content = content.replace(/<thead>[\s\S]*?<\/thead>/gi, '');

console.log('Cleaned content. Extracting rows...');

// Find all <tr> rows
const rowRegex = /<tr>([\s\S]*?)<\/tr>/gi;
let rowMatch;
const courses = [];

while ((rowMatch = rowRegex.exec(content)) !== null) {
    const rowContent = rowMatch[1];

    // Extract all <td> contents
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tdMatch;
    const tds = [];

    while ((tdMatch = tdRegex.exec(rowContent)) !== null) {
        let text = tdMatch[1].replace(/<[^>]+>/g, '').trim();
        tds.push(text);
    }

    if (tds.length < 11) continue;
    if (!tds[0] || !tds[1]) continue;

    courses.push({
        code: tds[0],
        name: tds[1],
        section: tds[2],
        credits: tds[3],
        professor: tds[4],
        room: tds[5],
        time: tds[6],
        semester: tds[7] || '',
        limit: tds[8] || '',
        enrolled: tds[9] || '',
        category: tds[10] || ''
    });
}

console.log(`Found ${courses.length} courses`);

if (courses.length === 0) {
    console.log('No courses found!');
    process.exit(1);
}

// Display width helper for CJK characters
function displayWidth(str) {
    let w = 0;
    for (const ch of str) {
        const code = ch.codePointAt(0);
        if (code >= 0x1100 && code <= 0xFFFF) {
            w += 2;
        } else {
            w += 1;
        }
    }
    return w;
}

function padStr(str, targetWidth, align = 'left') {
    const cur = displayWidth(str);
    const padding = Math.max(0, targetWidth - cur);
    if (align === 'center') {
        const left = Math.floor(padding / 2);
        const right = padding - left;
        return ' '.repeat(left) + str + ' '.repeat(right);
    } else if (align === 'right') {
        return ' '.repeat(padding) + str;
    }
    return str + ' '.repeat(padding);
}

const headers = ['교과목코드', '교과목명', '분반', '학점', '교수명', '강의실', '수업시간', '셀학기', '제한인원', '수강인원', '이수구분'];
const keys = ['code', 'name', 'section', 'credits', 'professor', 'room', 'time', 'semester', 'limit', 'enrolled', 'category'];
const centerKeys = new Set(['code', 'section', 'credits', 'limit', 'enrolled', 'semester']);

function buildTable(courseList) {
    // Calculate column widths
    const widths = headers.map((h, i) => {
        const key = keys[i];
        const hw = displayWidth(h);
        const maxVal = Math.max(...courseList.map(c => displayWidth(c[key] || '')), 0);
        return Math.max(hw, maxVal);
    });

    const lines = [];

    // Top border
    lines.push('┌' + widths.map(w => '─'.repeat(w + 2)).join('┬') + '┐');

    // Header row
    let hdr = '│';
    headers.forEach((h, i) => {
        hdr += ' ' + padStr(h, widths[i], 'center') + ' │';
    });
    lines.push(hdr);

    // Separator
    lines.push('├' + widths.map(w => '─'.repeat(w + 2)).join('┼') + '┤');

    // Data rows
    for (const c of courseList) {
        let row = '│';
        keys.forEach((k, i) => {
            const val = c[k] || '';
            const align = centerKeys.has(k) ? 'center' : 'left';
            row += ' ' + padStr(val, widths[i], align) + ' │';
        });
        lines.push(row);
    }

    // Bottom border
    lines.push('└' + widths.map(w => '─'.repeat(w + 2)).join('┴') + '┘');

    return lines.join('\n');
}

// Write full list
let out1 = '';
out1 += '═'.repeat(120) + '\n';
out1 += '                         2026학년도 1학기 수강 과목 목록\n';
out1 += '═'.repeat(120) + '\n\n';
out1 += `총 ${courses.length}개 교과목\n\n`;
out1 += buildTable(courses) + '\n';

fs.writeFileSync(outputPath, out1, 'utf-8');
console.log(`Written: ${outputPath} (${courses.length} courses)`);

// Group by category
const byCategory = {};
for (const c of courses) {
    const cat = c.category || '미분류';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(c);
}

const catNames = Object.keys(byCategory).sort();

let out2 = '';
out2 += '═'.repeat(120) + '\n';
out2 += '                    2026학년도 1학기 수강 과목 목록 (이수구분별)\n';
out2 += '═'.repeat(120) + '\n\n';
out2 += `총 ${courses.length}개 교과목\n\n`;

for (const cat of catNames) {
    const cl = byCategory[cat];
    out2 += `\n▶ ${cat} (${cl.length}개)\n`;
    out2 += '─'.repeat(80) + '\n';
    out2 += buildTable(cl) + '\n\n';
}

fs.writeFileSync(outputPath2, out2, 'utf-8');
console.log(`Written: ${outputPath2}`);

console.log('\n=== 이수구분별 요약 ===');
for (const cat of catNames) {
    console.log(`  ${cat}: ${byCategory[cat].length}개`);
}
console.log(`  Total: ${courses.length}개`);
