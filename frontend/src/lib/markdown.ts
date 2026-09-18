// The assistant writes light markdown; the admin's screen must never
// run what a client wrote. So: escape everything first, then add markup
// for a small allowlist — paragraphs, lists, emphasis, code, rules, and
// http(s) links. No raw HTML survives, whatever a message contained.

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

export function renderMarkdown(src: string): string {
  const lines = esc(src.replace(/\r\n/g, '\n')).split('\n');
  const out: string[] = [];
  let i = 0;
  const flushPara = (buf: string[]) => {
    if (buf.length) out.push(`<p>${inline(buf.join('<br>'))}</p>`);
    buf.length = 0;
  };
  const para: string[] = [];
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flushPara(para);
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre><code>${code.join('\n')}</code></pre>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara(para);
      out.push('<hr>');
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara(para);
      out.push(`<p class="md-h">${inline(h[2])}</p>`);
      i++;
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      flushPara(para);
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, '');
        i++;
        // Continuation lines indented under the bullet.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    // A pipe table: a header row, a separator row of dashes, then rows.
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flushPara(para);
      const cells = (row: string) =>
        row
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => inline(c.trim()));
      const head = cells(line);
      i += 2;
      const body: string[] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]))
        body.push(
          `<tr>${cells(lines[i++])
            .map((c) => `<td>${c}</td>`)
            .join('')}</tr>`,
        );
      out.push(
        `<div class="md-table"><table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body.join('')}</tbody></table></div>`,
      );
      continue;
    }
    if (/^\s*&gt;\s?/.test(line)) {
      flushPara(para);
      const q: string[] = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) q.push(lines[i++].replace(/^\s*&gt;\s?/, ''));
      out.push(`<blockquote>${inline(q.join('<br>'))}</blockquote>`);
      continue;
    }
    if (!line.trim()) {
      flushPara(para);
      i++;
      continue;
    }
    para.push(line);
    i++;
  }
  flushPara(para);
  return out.join('');
}
