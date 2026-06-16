import { type ReactNode, useEffect, useRef, useState } from "react";

type ScrollState = {
  left: boolean;
  right: boolean;
};

const SCROLL_EDGE_TOLERANCE = 1;

export function TableFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState<ScrollState>({
    left: false,
    right: false,
  });

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const frameElement = frame;

    function updateScrollState() {
      const maxScrollLeft = frameElement.scrollWidth - frameElement.clientWidth;
      const next = {
        left: frameElement.scrollLeft > SCROLL_EDGE_TOLERANCE,
        right: frameElement.scrollLeft < maxScrollLeft - SCROLL_EDGE_TOLERANCE,
      };
      setScrollState((current) =>
        current.left === next.left && current.right === next.right
          ? current
          : next,
      );
    }

    updateScrollState();
    frameElement.addEventListener("scroll", updateScrollState, {
      passive: true,
    });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(updateScrollState);
      resizeObserver.observe(frameElement);
      const table = frameElement.firstElementChild;
      if (table) {
        resizeObserver.observe(table);
      }
    }

    return () => {
      frameElement.removeEventListener("scroll", updateScrollState);
      resizeObserver?.disconnect();
    };
  }, []);

  const classes = [
    "table-frame",
    className,
    scrollState.left ? "can-scroll-left" : "",
    scrollState.right ? "can-scroll-right" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={frameRef}
      className={classes}
      tabIndex={scrollState.left || scrollState.right ? 0 : undefined}
    >
      {children}
    </div>
  );
}
