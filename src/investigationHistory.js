// One history entry per conversation, refreshed after each completed answer.
export function saveInvestigation(history, turns, allSources, now = Date.now()) {
  const entries = Array.isArray(history) ? history : [];
  if (!Array.isArray(turns) || !turns.length || turns[0]?.id == null) return entries;
  const firstId = turns[0].id;
  const previous = entries.find(entry => entry.turns?.[0]?.id === firstId);
  const entry = { ...previous, id: previous?.id || `h${firstId}`,
    title: previous?.title || String(turns[0].q || "Untitled investigation").slice(0, 140),
    ts: now, turns, allSources };
  return [entry, ...entries.filter(item => item.turns?.[0]?.id !== firstId)].slice(0, 40);
}
