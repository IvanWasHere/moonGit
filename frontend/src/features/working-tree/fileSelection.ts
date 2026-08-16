/**
 * Which files are selected in the Changes list, and how a click changes that
 * (PLAN.md §11, 8.17).
 *
 * Pure, and separate from the component, because the rules are the part that is
 * easy to get subtly wrong and impossible to see in a screenshot: a shift-click
 * that extends from the wrong end, a ⌘-click that clears instead of toggling, a
 * range that stops matching after the list is re-filtered.
 *
 * **The anchor is the whole of the difference between this and a `Set`.**
 * Shift-click extends from the last *plain* click, not from the nearest
 * selected row and not from wherever the previous shift-click happened to end.
 * Without one, shift-clicking twice in a row grows the selection in one
 * direction and can never shrink it, which is the behaviour people read as the
 * list being broken.
 */

export interface FileSelection {
  /** Every selected path. Order is irrelevant; membership is not. */
  readonly paths: ReadonlySet<string>;
  /**
   * Where a shift-click measures from — the last plain click, not the last
   * change. Null when nothing has been clicked yet.
   */
  readonly anchor: string | null;
  /**
   * The row whose diff is on screen. A multi-file selection still has one
   * "current" file, because the Changes pane shows exactly one diff.
   */
  readonly active: string | null;
}

export const EMPTY_SELECTION: FileSelection = {
  paths: new Set(),
  anchor: null,
  active: null,
};

export interface ClickModifiers {
  /** ⌘ on macOS, Ctrl elsewhere — toggle one row without disturbing the rest. */
  readonly toggle: boolean;
  /** Shift — extend from the anchor to here. */
  readonly range: boolean;
}

/**
 * Apply a click to the selection.
 *
 * `visible` is the list as displayed, filters and all, because a range means
 * "everything between these two *on screen*". Using the unfiltered list would
 * silently pull in rows the chips are hiding — and then stage them.
 */
export function clickFile(
  current: FileSelection,
  path: string,
  visible: readonly string[],
  modifiers: ClickModifiers = { toggle: false, range: false },
): FileSelection {
  if (modifiers.range && current.anchor !== null) {
    const from = visible.indexOf(current.anchor);
    const to = visible.indexOf(path);
    // Either end can have been filtered away since the anchor was set; a range
    // with no anchor on screen is not a range, so fall back to a plain click.
    if (from !== -1 && to !== -1) {
      const [lo, hi] = from <= to ? [from, to] : [to, from];
      return {
        paths: new Set(visible.slice(lo, hi + 1)),
        // The anchor deliberately does not move: shift-clicking again should
        // re-measure from the same origin, which is what lets a range shrink.
        anchor: current.anchor,
        active: path,
      };
    }
  }

  if (modifiers.toggle) {
    const paths = new Set(current.paths);
    if (paths.has(path)) {
      paths.delete(path);
      return {
        paths,
        anchor: path,
        // Deselecting the row whose diff is showing leaves the pane on
        // whatever else is selected rather than on a file that is no longer.
        active: current.active === path ? (paths.values().next().value ?? null) : current.active,
      };
    }
    paths.add(path);
    return { paths, anchor: path, active: path };
  }

  // A plain click replaces the selection and sets the anchor.
  return { paths: new Set([path]), anchor: path, active: path };
}

/** ⌘A — everything currently on screen, filters included. */
export function selectAll(visible: readonly string[]): FileSelection {
  if (visible.length === 0) return EMPTY_SELECTION;
  return {
    paths: new Set(visible),
    // The anchor goes to the top so a following shift-click narrows from
    // there, which is the only reading of "extend" that is useful after a
    // select-all.
    anchor: visible[0] ?? null,
    active: visible[0] ?? null,
  };
}

/**
 * Drop anything no longer on screen.
 *
 * The list re-filters constantly — the watcher fires on every save, and the
 * chips and the text filter both narrow it. A selection holding paths that are
 * no longer visible is a selection that would stage files the user cannot see.
 */
export function pruneSelection(
  current: FileSelection,
  visible: readonly string[],
): FileSelection {
  const onScreen = new Set(visible);
  const paths = new Set([...current.paths].filter((path) => onScreen.has(path)));
  if (paths.size === current.paths.size) return current;
  return {
    paths,
    anchor: current.anchor !== null && onScreen.has(current.anchor) ? current.anchor : null,
    active: current.active !== null && paths.has(current.active) ? current.active : null,
  };
}
