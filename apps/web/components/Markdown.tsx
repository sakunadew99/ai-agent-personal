import { Fragment, ReactNode } from "react";

/**
 * Small, safe Markdown renderer for assistant replies. Builds React elements (no innerHTML), so model output
 * can never inject markup or scripts. Supports headings, paragraphs, bullet/numbered lists, fenced code,
 * inline code, **bold**, *italic*, [links](https://...) and horizontal rules.
 */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\((https?:\/\/[^\s)]+)\))/g;
  let last = 0; let m: RegExpExecArray | null; let i = 0;
  while ((m = pattern.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyBase}-${i++}`;
    if (m[1]) out.push(<code key={k}>{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{inline(m[2].slice(2, -2), k)}</strong>);
    else if (m[3]) out.push(<em key={k}>{inline(m[3].slice(1, -1), k)}</em>);
    else if (m[4]) { const label = m[4].slice(1, m[4].indexOf("](")); out.push(<a key={k} href={m[5]} target="_blank" rel="noopener noreferrer">{label}</a>); }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0; let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const body: string[] = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={key++} className="md-code"><code>{body.join("\n")}</code></pre>);
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(4, heading[1].length + 1);
      const Tag = (`h${level}`) as "h2" | "h3" | "h4" | "h5";
      blocks.push(<Tag key={key++}>{inline(heading[2], `h${key}`)}</Tag>);
      i++; continue;
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { blocks.push(<hr key={key++}/>); i++; continue; }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*+]\s+/, ""));
      blocks.push(<ul key={key++}>{items.map((item, j) => <li key={j}>{inline(item, `u${key}-${j}`)}</li>)}</ul>);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      blocks.push(<ol key={key++}>{items.map((item, j) => <li key={j}>{inline(item, `o${key}-${j}`)}</li>)}</ol>);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|\s*[-*+]\s+|\s*\d+[.)]\s+)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={key++}>{para.map((p, j) => <Fragment key={j}>{j > 0 && <br/>}{inline(p, `p${key}-${j}`)}</Fragment>)}</p>);
  }
  return <div className="md">{blocks}</div>;
}
