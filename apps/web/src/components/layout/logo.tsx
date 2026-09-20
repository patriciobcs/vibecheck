import type { SVGProps } from "react";

/**
 * VibeCheck mark: a signal line that resolves into a check. Single stroke in `currentColor`, so
 * it reads at 16 px in a tab, in the nav, and on the dark log panels.
 */
export function LogoMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" fill="none" role="img" {...props}>
      <title>VibeCheck</title>
      <path
        d="M3 18h4l3-8 4 14 3-9h3l3 4 6-8"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
