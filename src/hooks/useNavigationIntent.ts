import { useCallback, useEffect, useRef } from "react";

/** A delayed open must yield to the user's next click, keystroke or navigation. */
export function useNavigationIntent() {
  const generation = useRef(0);
  useEffect(() => {
    const cancel = () => {
      generation.current += 1;
    };
    window.addEventListener("pointerdown", cancel, true);
    window.addEventListener("keydown", cancel, true);
    return () => {
      cancel();
      window.removeEventListener("pointerdown", cancel, true);
      window.removeEventListener("keydown", cancel, true);
    };
  }, []);
  return useCallback(() => {
    const requested = ++generation.current;
    return () => generation.current === requested;
  }, []);
}
