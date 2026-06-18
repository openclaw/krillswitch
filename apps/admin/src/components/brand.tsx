/* Brand logo and the shared icon set. The logo art lives in
   src/assets/brand as true-vector SVGs; light (navy text) and dark (white
   text) variants are swapped by the `data-theme` on <html>. */

import longNavy from "../assets/brand/krillswitch_long_navy_text.svg";
import longWhite from "../assets/brand/krillswitch_long_white_text.svg";
import stackedNavy from "../assets/brand/krillswitch_stacked_navy_text.svg";
import stackedWhite from "../assets/brand/krillswitch_stacked_white_text.svg";

/** krillswitch logo. `compact` is the small horizontal lockup for the topbar;
 *  the default is the stacked hero used on the auth screens. Both theme
 *  variants are rendered and the inactive one is hidden via CSS, so the right
 *  one shows from the first paint with no flash. */
export function Brandmark({ compact = false }: { compact?: boolean }) {
  const light = compact ? longNavy : stackedNavy;
  const dark = compact ? longWhite : stackedWhite;
  return (
    <span
      className={`brandmark ${compact ? "brandmark-long" : "brandmark-stacked"}`}
    >
      <img
        className="brandmark-img brandmark-img-light"
        src={light}
        alt="krillswitch"
      />
      <img
        className="brandmark-img brandmark-img-dark"
        src={dark}
        alt="krillswitch"
      />
    </span>
  );
}

type IconProps = { className?: string };
const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function ShieldIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export function PencilIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M14.5 5.5l4 4M4 20l1-4L16 5a2.1 2.1 0 0 1 3 3L8 19l-4 1Z" />
    </svg>
  );
}

export function EyeIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function LockIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="9" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  );
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function CrossIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

export function FolderIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </svg>
  );
}

export function ListIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  );
}

export function UsersIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1" />
      <circle cx="9" cy="7" r="3" />
      <path d="M22 19v-1a4 4 0 0 0-3-3.9M16 4.1A4 4 0 0 1 16 12" />
    </svg>
  );
}

export function RetryIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M3.5 12a8.5 8.5 0 1 1 2.5 6" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

export function ArrowRightIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  );
}

export function LayersIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="M3 13l9 5 9-5" />
    </svg>
  );
}

/** Abstract krillswitch logomark used in the boot/error icon disc. */
export function KrillMark({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M8 4v9a4 4 0 0 0 8 0V4" />
      <path d="M6 11h12" />
    </svg>
  );
}
