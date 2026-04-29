/**
 * Shared regex/glob utilities for grep_search, file_search, vfs_grep_search,
 * and vfs_file_search tools.
 */

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Convert a glob pattern to a RegExp.
 *
 * Rules:
 *   **\/  = zero or more path components (with trailing slash consumed)
 *   **    = anything (including slashes), at end of pattern
 *   *     = any characters except a path separator
 *   ?     = any single character except a path separator
 *
 * Bug fix: previously the double-star glob emitted .* which matched 'ab'
 * for a pattern like a-double-star-b. Now emits (.*\/)? so the separator
 * is required when there is at least one intermediate directory.
 */
export function globToRegex(pattern: string): RegExp {
  let r = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      i += 2;
      if (pattern[i] === '/') {
        // **/ = zero or more directory levels (each followed by /)
        r += '(.*\\/)?';
        i++;
      } else {
        // ** at end = match anything including slashes
        r += '.*';
      }
    } else if (ch === '*') {
      r += '[^/]*';
      i++;
    } else if (ch === '?') {
      r += '[^/]';
      i++;
    } else {
      r += escapeRegex(ch);
      i++;
    }
  }
  return new RegExp(r + '$');
}
