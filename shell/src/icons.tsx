/** Thin-line geometric marks — consistent stroke across the Residence shell. */

type P = { className?: string };

const S = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IconHome({ className }: P) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path {...S} d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" />
    </svg>
  );
}

export function IconVoice({ className }: P) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <rect {...S} x="9" y="3.5" width="6" height="11" rx="3" />
      <path {...S} d="M6 11a6 6 0 0 0 12 0M12 17v3.5M9 20.5h6" />
    </svg>
  );
}

export function IconCal({ className }: P) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <rect {...S} x="3.5" y="5" width="17" height="15.5" rx="1" />
      <path {...S} d="M3.5 9.5h17M8 3.5v3M16 3.5v3M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01" />
    </svg>
  );
}

export function IconWallet({ className }: P) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path {...S} d="M3.5 8.5h17v10a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-10Z" />
      <path {...S} d="M3.5 8.5 5.2 5h11.6l1.7 3.5M16 13.5h2.5" />
    </svg>
  );
}

export function IconShop({ className }: P) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path {...S} d="M6 8V7a6 6 0 1 1 12 0v1" />
      <path {...S} d="M4.5 8.5h15l-1.2 10.2a1.5 1.5 0 0 1-1.5 1.3H7.2a1.5 1.5 0 0 1-1.5-1.3L4.5 8.5Z" />
    </svg>
  );
}

export function IconHeart({ className }: P) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        {...S}
        d="M12 20s-7-4.4-9-8.8C1.5 7.8 3 5 6.2 4.4c1.8-.35 3.5.4 4.6 1.8 1.1-1.4 2.8-2.15 4.6-1.8C18.6 5 20.1 7.8 18.6 11.2 16.6 15.6 12 20 12 20Z"
      />
    </svg>
  );
}

export function IconClaude({ className }: P) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path {...S} d="M12 3.5 13.6 9l5.4 1.6-5.4 1.6L12 17.8l-1.6-5.6L5 10.6 10.4 9 12 3.5Z" />
    </svg>
  );
}

export function IconMaps({ className }: P) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path {...S} d="M12 21s-6.5-5.8-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5.2-6.5 11-6.5 11Z" />
      <circle {...S} cx="12" cy="10" r="2.2" />
    </svg>
  );
}

export function IconNotes({ className }: P) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path {...S} d="M6 3.5h9.5L20 8v12.5H6z" />
      <path {...S} d="M15.5 3.5V8H20M9 12h6M9 15.5h6M9 8.5h3" />
    </svg>
  );
}

export function IconWeather({ className }: P) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path {...S} d="M7.5 17.5a4 4 0 1 1 .6-7.95A5.2 5.2 0 0 1 18 11.2 3.4 3.4 0 1 1 17.2 17.5H7.5Z" />
    </svg>
  );
}

export function IconYouTube({ className }: P) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <rect {...S} x="3" y="6" width="18" height="12" rx="2" />
      <path {...S} d="M11 9.5v5l4.5-2.5L11 9.5Z" />
    </svg>
  );
}

export function IconMenu({ className }: P) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path {...S} d="M5 7h14M5 12h14M5 17h14" />
    </svg>
  );
}

export function IconApps({ className }: P) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <rect {...S} x="4" y="4" width="6" height="6" />
      <rect {...S} x="14" y="4" width="6" height="6" />
      <rect {...S} x="4" y="14" width="6" height="6" />
      <rect {...S} x="14" y="14" width="6" height="6" />
    </svg>
  );
}
