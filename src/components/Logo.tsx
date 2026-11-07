/**
 * The mark of alcyone: the seven bright stars of the Pleiades, the cluster whose brightest
 * star is Alcyone. It takes the color of the accent.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" fill="currentColor">
      <circle cx="30" cy="34" r="7.5" />
      <circle cx="11" cy="33" r="5" />
      <circle cx="12" cy="20" r="3.5" />
      <circle cx="37" cy="51" r="5" />
      <circle cx="50" cy="40" r="5.5" />
      <circle cx="47" cy="22" r="4.5" />
      <circle cx="56" cy="10" r="4" />
    </svg>
  );
}
