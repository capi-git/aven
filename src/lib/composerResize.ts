/** Matches the composer's `max-h-40`, so the field stops growing where it clips. */
export const COMPOSER_MAX_HEIGHT = 160;

type Resizable = {
  style: { height: string };
  scrollHeight: number;
  parentElement?: {
    style: { minHeight: string };
    offsetHeight: number;
  } | null;
};

/** A hidden tab stays mounted with no layout box, so it reports 0 here. */
export function resizeComposer(el: Resizable) {
  if (el.scrollHeight === 0) return;
  const wrapper = el.parentElement;
  const minHeight = wrapper?.style.minHeight ?? "";
  // Measuring at `auto` briefly collapses the field. Keep its space until the
  // final height is set, so the transcript above never sees a taller viewport
  // that clamps a reader just above the end down to the bottom.
  if (wrapper) wrapper.style.minHeight = `${wrapper.offsetHeight}px`;
  try {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  } finally {
    if (wrapper) wrapper.style.minHeight = minHeight;
  }
}
