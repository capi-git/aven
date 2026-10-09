import {
  memo,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ElementType,
} from "react";
import { isWindowActive, subscribeWindowActivity } from "../lib/windowActivity";

export interface ShimmerProps {
  children: string;
  as?: ElementType;
  className?: string;
  duration?: number;
  spread?: number;
}

function ShimmerComponent({
  children,
  as: Component = "span",
  className = "",
  duration = 2,
  spread = 2,
}: ShimmerProps) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let intersecting = typeof IntersectionObserver === "undefined";
    const update = () => {
      element.style.animationPlayState =
        intersecting && isWindowActive() ? "running" : "paused";
    };
    const unsubscribe = subscribeWindowActivity(update);
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            intersecting = entry?.isIntersecting ?? false;
            update();
          });
    observer?.observe(element);
    update();
    return () => {
      observer?.disconnect();
      unsubscribe();
    };
  }, []);
  const dynamicSpread = useMemo(
    () => (children?.length ?? 0) * spread,
    [children, spread],
  );

  return (
    <Component
      ref={ref}
      className={`shimmer-text relative inline-block ${className}`.trim()}
      style={
        {
          "--spread": `${dynamicSpread}px`,
          "--shimmer-duration": `${duration}s`,
        } as CSSProperties
      }
    >
      {children}
    </Component>
  );
}

export const Shimmer = memo(ShimmerComponent);
