/**
 * Text predicates for `wait_text`.
 *
 * Kept separate (and pure) so the matcher can be unit-tested without a desktop:
 * the polling loop is trivial, the semantics of "contains / absent / regex" are
 * where the bugs live.
 */

const norm = (value, ignoreCase) => {
  const s = String(value ?? '');
  return ignoreCase ? s.toLowerCase() : s;
};

/**
 * Does `text` satisfy the condition?
 *
 * All provided needles must hold:
 *   contains — the text must include it
 *   absent   — the text must NOT include it
 *   regex    — the text must match it (invalid patterns simply never match)
 *
 * An empty condition matches everything, so callers must validate that at
 * least one needle was supplied (the tool schema does).
 */
export function textMatches(text, { contains, absent, regex, ignoreCase = true } = {}) {
  const hay = norm(text, ignoreCase);
  if (contains !== undefined && contains !== null && String(contains) !== '') {
    if (!hay.includes(norm(contains, ignoreCase))) return false;
  }
  if (absent !== undefined && absent !== null && String(absent) !== '') {
    if (hay.includes(norm(absent, ignoreCase))) return false;
  }
  if (regex !== undefined && regex !== null && String(regex) !== '') {
    try {
      const re = new RegExp(String(regex), ignoreCase ? 'i' : '');
      if (!re.test(String(text ?? ''))) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** True when the caller actually asked for something to wait on. */
export function hasCondition({ contains, absent, regex } = {}) {
  return [contains, absent, regex].some((v) => v !== undefined && v !== null && String(v) !== '');
}
