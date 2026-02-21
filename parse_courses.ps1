<#
Parse university course listing HTML file.
Removes all JavaScript/HTML and outputs formatted course tables.
#>

$inputPath = "c:\Users\ehdrjs10w\Desktop\mammoth\txt"
$outputPath = "c:\Users\ehdrjs10w\Desktop\mammoth\수강목록_전체.txt"
$outputPath2 = "c:\Users\ehdrjs10w\Desktop\mammoth\수강목록_이수구분별.txt"

Write-Host "Reading file..."
$content = [System.IO.File]::ReadAllText($inputPath, [System.Text.Encoding]::UTF8)
Write-Host "File size: $($content.Length) chars"

# Remove script blocks
$content = [regex]::Replace($content, '<script[^>]*>.*?</script>', '', [System.Text.RegularExpressions.RegexOptions]::Singleline)

# Remove input tags
$content = [regex]::Replace($content, '<input[^>]*/?\s*>', '', [System.Text.RegularExpressions.RegexOptions]::Singleline)

# Remove <a> tags and content
$content = [regex]::Replace($content, '<a[^>]*>.*?</a>', '', [System.Text.RegularExpressions.RegexOptions]::Singleline)

# Remove thead sections
$content = [regex]::Replace($content, '<thead>.*?</thead>', '', [System.Text.RegularExpressions.RegexOptions]::Singleline)

Write-Host "Cleaned content. Extracting rows..."

# Find all <tr> rows
$rowMatches = [regex]::Matches($content, '<tr>(.*?)</tr>', [System.Text.RegularExpressions.RegexOptions]::Singleline)
Write-Host "Found $($rowMatches.Count) rows"

$courses = New-Object System.Collections.ArrayList

foreach ($rowMatch in $rowMatches) {
    $rowContent = $rowMatch.Groups[1].Value
    
    # Extract all <td> contents
    $tdMatches = [regex]::Matches($rowContent, '<td[^>]*>(.*?)</td>', [System.Text.RegularExpressions.RegexOptions]::Singleline)
    
    if ($tdMatches.Count -lt 11) { continue }
    
    $tds = New-Object System.Collections.ArrayList
    foreach ($td in $tdMatches) {
        $text = $td.Groups[1].Value
        $text = [regex]::Replace($text, '<[^>]+>', '')
        $text = $text.Trim()
        [void]$tds.Add($text)
    }
    
    if (-not $tds[0] -or -not $tds[1]) { continue }
    
    $sem = ""
    $lim = ""
    $enr = ""
    $cat = ""
    if ($tds.Count -gt 7) { $sem = $tds[7] }
    if ($tds.Count -gt 8) { $lim = $tds[8] }
    if ($tds.Count -gt 9) { $enr = $tds[9] }
    if ($tds.Count -gt 10) { $cat = $tds[10] }
    
    $course = [PSCustomObject]@{
        Code = $tds[0]
        Name = $tds[1]
        Section = $tds[2]
        Credits = $tds[3]
        Professor = $tds[4]
        Room = $tds[5]
        Time = $tds[6]
        Semester = $sem
        Limit = $lim
        Enrolled = $enr
        Category = $cat
    }
    
    [void]$courses.Add($course)
}

Write-Host "Found $($courses.Count) courses"

if ($courses.Count -eq 0) {
    Write-Host "No courses found!"
    exit
}

# Build simple text table
function Build-Table {
    param($courseList)
    
    $sb = New-Object System.Text.StringBuilder
    
    $fmt = "{0,-12} {1,-30} {2,-6} {3,-6} {4,-12} {5,-18} {6,-18} {7,-8} {8,-8} {9,-8} {10,-10}"
    
    [void]$sb.AppendLine(("=" * 140))
    [void]$sb.AppendLine(($fmt -f '교과목코드', '교과목명', '분반', '학점', '교수명', '강의실', '수업시간', '셀학기', '제한인원', '수강인원', '이수구분'))
    [void]$sb.AppendLine(("=" * 140))
    
    foreach ($c in $courseList) {
        [void]$sb.AppendLine(($fmt -f $c.Code, $c.Name, $c.Section, $c.Credits, $c.Professor, $c.Room, $c.Time, $c.Semester, $c.Limit, $c.Enrolled, $c.Category))
    }
    
    [void]$sb.AppendLine(("=" * 140))
    
    return $sb.ToString()
}

# Write full list
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine(("=" * 120))
[void]$sb.AppendLine("                         2026학년도 1학기 수강 과목 목록")
[void]$sb.AppendLine(("=" * 120))
[void]$sb.AppendLine("")
[void]$sb.AppendLine("총 $($courses.Count)개 교과목")
[void]$sb.AppendLine("")
[void]$sb.Append((Build-Table $courses))

[System.IO.File]::WriteAllText($outputPath, $sb.ToString(), (New-Object System.Text.UTF8Encoding $true))
Write-Host "Written: $outputPath ($($courses.Count) courses)"

# Group by category
$byCategory = $courses | Group-Object -Property Category | Sort-Object -Property Name

$sb2 = New-Object System.Text.StringBuilder
[void]$sb2.AppendLine(("=" * 120))
[void]$sb2.AppendLine("                    2026학년도 1학기 수강 과목 목록 (이수구분별)")
[void]$sb2.AppendLine(("=" * 120))
[void]$sb2.AppendLine("")
[void]$sb2.AppendLine("총 $($courses.Count)개 교과목")
[void]$sb2.AppendLine("")

foreach ($group in $byCategory) {
    $catName = $group.Name
    if (-not $catName) { $catName = "미분류" }
    [void]$sb2.AppendLine("")
    [void]$sb2.AppendLine(("▶ " + $catName + " (" + $group.Count + "개)"))
    [void]$sb2.AppendLine(("-" * 80))
    [void]$sb2.Append((Build-Table $group.Group))
    [void]$sb2.AppendLine("")
}

[System.IO.File]::WriteAllText($outputPath2, $sb2.ToString(), (New-Object System.Text.UTF8Encoding $true))
Write-Host "Written: $outputPath2"

Write-Host ""
Write-Host "=== 이수구분별 요약 ==="
foreach ($group in $byCategory) {
    $catName = $group.Name
    if (-not $catName) { $catName = "미분류" }
    Write-Host ("  " + $catName + ": " + $group.Count + "개")
}
Write-Host "  Total: $($courses.Count)개"
