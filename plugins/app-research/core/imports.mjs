// RFC 4180-style CSV, including escaped quotes and multiline source excerpts.
function csvRows(input) {
  const rows = []; let row = [], value = '', quoted = false, afterQuote = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') { value += '"'; i++; }
      else if (c === '"') { quoted = false; afterQuote = true; }
      else value += c;
    } else if (c === '"' && value === '' && !afterQuote) quoted = true;
    else if (c === ',') { row.push(value); value = ''; afterQuote = false; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(value); if (row.some(v => v !== '')) rows.push(row); row = []; value = ''; afterQuote = false;
    } else if (afterQuote) { if (c !== ' ' && c !== '\t') throw new Error('Malformed CSV after closing quote'); }
    else if (c === '"') throw new Error('CSV quotes must enclose the whole field');
    else value += c;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field');
  row.push(value); if (row.some(v => v !== '')) rows.push(row);
  return rows;
}
export function parseSources(format, input) {
  if (typeof input !== 'string' || input.length > 1000000) throw new Error('Import must be text under 1 MB');
  let records;
  if (format === 'json') records = JSON.parse(input);
  else if (format === 'csv') {
    const [header, ...rows] = csvRows(input.replace(/^\uFEFF/, ''));
    if (!header || new Set(header).size !== header.length) throw new Error('CSV needs unique column names');
    for (const field of ['url', 'content', 'provenance_note']) if (!header.includes(field)) throw new Error(`CSV is missing ${field}`);
    records = rows.map(row => {
      if (row.length !== header.length) throw new Error('CSV row length does not match the header');
      return Object.fromEntries(header.map((h, i) => [h.trim(), row[i]]));
    });
  } else throw new Error('Choose JSON or CSV');
  if (!Array.isArray(records) || records.length < 1 || records.length > 100 || records.some(r => !r || typeof r !== 'object' || Array.isArray(r))) throw new Error('Import must contain 1–100 source records');
  const fields = ['url', 'title', 'content', 'family', 'context_id', 'published_at', 'provenance_note'];
  return records.map(record => Object.fromEntries(fields.filter(f => record[f] !== undefined).map(f => [f, record[f]])));
}
