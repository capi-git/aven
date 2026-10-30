import { dotArtPath } from "../lib/dotSigils";

const GRID_W = 22;

// Overlapping speech bubbles in round dots, with a dim scatter around them.
const BUBBLES = [
  "..###########.........",
  ".##.........##........",
  ".#...........#........",
  ".#...#.#.#...#........",
  ".#...........#........",
  ".##.........##........",
  "..##########..........",
  "..##.........#######..",
  "..#.........##.....##.",
  "............#.......#.",
  "............#.#.#.#.#.",
  "............#.......#.",
  "............##.....##.",
  ".............#######..",
  "..................##..",
  "...................#..",
];

const GLOW = [
  "#.............#.......",
  "......................",
  "......................",
  "#.............#.......",
  "......................",
  "......................",
  "#.....................",
  "...........#.........#",
  "......................",
  "......................",
  "...........#.........#",
  "......................",
  "......................",
  ".....................#",
  "......................",
  "......................",
];

const BUBBLES_PATH = dotArtPath(BUBBLES);
const GLOW_PATH = dotArtPath(GLOW);

/** Empty state for a discussion that has no messages yet. */
export function DiscussionEmpty({ message }: { message: string }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-5 px-6 py-10 text-center">
      <svg
        aria-hidden
        viewBox={`0 0 ${GRID_W} ${BUBBLES.length}`}
        className="w-24 text-content/25"
        fill="currentColor"
      >
        <path d={GLOW_PATH} opacity={0.4} />
        <path d={BUBBLES_PATH} />
      </svg>
      <p className="text-ui-body leading-relaxed text-content/45">{message}</p>
    </div>
  );
}
