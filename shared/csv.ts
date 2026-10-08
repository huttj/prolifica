/** RFC 4180-ish CSV: quoted fields, doubled quotes, CRLF or LF. Returns rows of strings. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      rows.push(row); row = []
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

/** Rows as objects keyed by the header, with numbers that look like numbers turned into numbers. */
export function parseCsv(text: string): Record<string, string | number>[] {
  const [header, ...rows] = parseCsvRows(text.replace(/^﻿/, ''))
  if (!header) return []
  return rows.map((r) => {
    const o: Record<string, string | number> = {}
    header.forEach((h, i) => {
      const v = r[i] ?? ''
      o[h] = v !== '' && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v.trim()) ? Number(v) : v
    })
    return o
  })
}
