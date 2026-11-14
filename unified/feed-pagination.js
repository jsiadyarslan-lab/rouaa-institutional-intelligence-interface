'use strict';
/* ROUAA feed pagination presentation logic (R2D §6) — pure, unit-testable, trust-free.
   This module owns ONLY the cursor/pagination decision logic of the Intelligence Feed:
   - the four documented next_cursor cases (next / last / missing / invalid),
   - the current cursor + previous-page navigation stack.
   It interprets nothing about WHERE a payload came from and confers no trust: it operates on
   plain objects handed to it (in the product these are unverified-upstream payloads rendered
   under the UPSTREAM ORIGIN UNVERIFIED banner; in tests they are synthetic fixtures confined to
   the test file). It performs no network calls and holds no product data of its own.
   The stack has no internal cap: navigation history is never silently dropped (R2C §5). */
function classifyNextCursor(body) {
  if (!body || typeof body !== 'object' || !('next_cursor' in body)) return { case: 'missing', next: null };
  const v = body.next_cursor;
  if (v === null) return { case: 'last', next: null };
  if (typeof v === 'string' && v.length > 0) return { case: 'next', next: v };
  return { case: 'invalid', next: null }; /* number, object, empty string… — continuation unknown */
}

function createFeedPager() {
  let current = null; /* null = first page */
  const stack = []; /* previous-page cursors, oldest first */
  return {
    get current() { return current; },
    get stackLength() { return stack.length; },
    get canPrevious() { return stack.length > 0; },
    goNext(nextCursor) {
      if (typeof nextCursor !== 'string' || !nextCursor) return false; /* only a valid cursor advances */
      stack.push(current);
      current = nextCursor;
      return true;
    },
    goPrevious() {
      if (!stack.length) return false;
      current = stack.pop();
      return current; /* cursor of the previous page (or null for the first page) */
    },
    retry() { return current; } /* same cursor re-requested — a retry never mutates cursor or stack */
  };
}
if (typeof module !== 'undefined') module.exports = { classifyNextCursor, createFeedPager };
