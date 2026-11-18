export interface SpotlightEntry {
  paneId: string;
  title: string;
  surfaceKind: string;
  /** Extra text, such as a group name, that can match without marking the title. */
  keywords?: string;
}

export interface SpotlightHit extends SpotlightEntry {
  score: number;
  /** Character indexes in `title` that matched the query. */
  titleMarks: number[];
}

interface FieldScore {
  score: number;
  marks: number[];
}

/** Rank panes the way Spotlight ranks hits: prefix, then word, then substring, then a loose subsequence. */
export function searchPanes(panes: readonly SpotlightEntry[], query: string, activeId?: string | null): SpotlightHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    const rest = panes.filter((pane) => pane.paneId !== activeId);
    const active = panes.find((pane) => pane.paneId === activeId);
    const ordered = active ? [active, ...rest] : [...panes];
    return ordered.map((pane) => ({ ...pane, score: 0, titleMarks: [] }));
  }

  const ranked: { hit: SpotlightHit; index: number }[] = [];
  panes.forEach((pane, index) => {
    const title = scoreField(pane.title, needle);
    const id = scoreField(pane.paneId, needle);
    const kind = scoreField(pane.surfaceKind, needle);
    const keywords = pane.keywords ? scoreField(pane.keywords, needle) : null;
    const best = bestScore([
      title,
      id ? { score: id.score * 0.9, marks: [] } : null,
      kind ? { score: kind.score * 0.75, marks: [] } : null,
      keywords ? { score: keywords.score * 0.7, marks: [] } : null,
    ]);
    if (!best) return;
    ranked.push({
      index,
      hit: { ...pane, score: best.score, titleMarks: best.marks },
    });
  });
  ranked.sort((left, right) => right.hit.score - left.hit.score || left.index - right.index);
  return ranked.map((item) => item.hit);
}

function bestScore(scores: (FieldScore | null)[]): FieldScore | null {
  let best: FieldScore | null = null;
  for (const score of scores) {
    if (!score) continue;
    if (!best || score.score > best.score) best = score;
  }
  return best;
}

function scoreField(text: string, needle: string): FieldScore | null {
  const hay = text.toLowerCase();
  if (hay.startsWith(needle)) return { score: 100, marks: range(needle.length) };
  const at = hay.indexOf(needle);
  if (at >= 0) {
    const boundary = /[^a-z0-9]/i.test(hay[at - 1] ?? "");
    return { score: boundary ? 80 : 55, marks: range(needle.length, at) };
  }
  const marks = subsequence(hay, needle);
  if (!marks) return null;
  return { score: 20 + marks.length, marks };
}

function subsequence(hay: string, needle: string): number[] | null {
  const marks: number[] = [];
  let start = 0;
  for (const char of needle) {
    const at = hay.indexOf(char, start);
    if (at < 0) return null;
    marks.push(at);
    start = at + 1;
  }
  return marks;
}

function range(length: number, start = 0): number[] {
  return Array.from({ length }, (_, index) => start + index);
}
