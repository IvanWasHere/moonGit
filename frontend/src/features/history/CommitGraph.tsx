import { LANE_COLORS, type GraphRow } from './graph';
import styles from './CommitGraph.module.css';

/**
 * The lines and node drawn beside one commit row.
 *
 * **The SVG stretches; the node does not.** Journal rows are not a fixed height
 * — a commit carrying ref decorations is taller than one without — so the SVG
 * is given a `viewBox` of a nominal height and `preserveAspectRatio="none"`,
 * which lets the lines scale to whatever the row turned out to be. That would
 * also stretch the node into an ellipse and skew the stroke widths, so the node
 * is a CSS circle positioned over the top, and the strokes are marked
 * `non-scaling-stroke`.
 *
 * The alternative — forcing every journal row to one height — would mean
 * truncating decorations, and the graph is not worth that.
 */

/** Nominal row height in user units; the viewBox scales it to the real one. */
const H = 100;
/** Horizontal spacing between lanes, in pixels, which never scales. */
export const LANE_WIDTH = 14;
const LEFT = 9;

function laneX(lane: number): number {
  return LEFT + lane * LANE_WIDTH;
}

/**
 * A line between two lanes.
 *
 * Straight when the lanes match, an S-curve when they do not: a diagonal
 * meeting a vertical at a sharp angle reads as a different kind of connection
 * than it is, and the curve is what makes a merge look like a merge.
 */
function path(from: number, to: number, span: 'top' | 'bottom' | 'full'): string {
  const x1 = laneX(from);
  const x2 = laneX(to);
  const [y1, y2] = span === 'top' ? [0, H / 2] : span === 'bottom' ? [H / 2, H] : [0, H];

  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const mid = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
}

export function CommitGraph({ row, lanes }: { readonly row: GraphRow; readonly lanes: number }) {
  const width = Math.max(1, lanes) * LANE_WIDTH + LEFT;
  const color = LANE_COLORS[row.color] ?? LANE_COLORS[0];

  return (
    <div className={styles.graph} style={{ width }}>
      <svg
        className={styles.lines}
        viewBox={`0 0 ${width} ${H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {row.edges.map((edge, index) => (
          <path
            key={index}
            d={path(edge.from, edge.to, edge.span)}
            fill="none"
            stroke={LANE_COLORS[edge.color] ?? LANE_COLORS[0]}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <span
        className={`${styles.node} ${row.isMerge ? styles.merge : ''}`}
        // `color` rather than `border-color`: the merge variant fills with
        // `currentColor`, so one property drives both the ring and the fill.
        style={{ left: laneX(row.lane), color }}
        // A merge is worth telling apart at a glance; the ring says so without
        // needing a legend.
        title={row.isMerge ? 'Merge commit' : undefined}
      />
    </div>
  );
}
