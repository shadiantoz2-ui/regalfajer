import { cn } from "@/lib/utils";

export function AlGhufranLogo({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative inline-flex items-center justify-center select-none",
        compact ? "size-20" : "size-32 md:size-40",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-1 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--primary)_26%,transparent)_0%,transparent_72%)]"
      />
      <svg
        viewBox="0 0 220 220"
        role="img"
        aria-label="شعار مسجد الغفران"
        className="relative size-full drop-shadow-[0_6px_22px_color-mix(in_oklab,var(--primary)_42%,transparent)]"
      >
        <defs>
          <linearGradient id="ghufran-gold" x1="15%" y1="5%" x2="85%" y2="95%">
            <stop offset="0%" stopColor="#FDF0B5" />
            <stop offset="48%" stopColor="#EBB94E" />
            <stop offset="100%" stopColor="#C48422" />
          </linearGradient>
        </defs>

        {/* Crescent above minaret */}
        <path
          d="M179 11a7 7 0 1 0 5.5 11.3 5.5 5.5 0 1 1-5.5-11.3Z"
          fill="url(#ghufran-gold)"
        />
        <rect x="177.2" y="21" width="2.6" height="6" rx="1.2" fill="url(#ghufran-gold)" />

        {/* Minaret arch dome & upper shaft */}
        <path
          d="M161 60V46c0-10.5 7.6-19 17-19s17 8.5 17 19v14h-8.5V46.5c0-5.2-3.8-9.5-8.5-9.5s-8.5 4.3-8.5 9.5V60H161Z"
          fill="url(#ghufran-gold)"
        />
        <rect x="175" y="45" width="6" height="12" rx="2" fill="url(#ghufran-gold)" />

        {/* Twin vertical minaret columns (Alif + Lam transition) */}
        <rect x="161" y="64" width="11" height="29" rx="1.5" fill="url(#ghufran-gold)" />
        <rect x="184" y="64" width="11" height="44" rx="1.5" fill="url(#ghufran-gold)" />

        {/* Intersecting Kufic Lam-Alif */}
        <path
          d="M184 92L161 117v27h11v-22.5l23-24.5V89l-11 3Z"
          fill="url(#ghufran-gold)"
        />
        <rect x="184" y="114" width="11" height="30" rx="1.5" fill="url(#ghufran-gold)" />

        {/* Baseline bar under Al-Ghufran */}
        <rect x="73" y="149" width="122" height="9" rx="2" fill="url(#ghufran-gold)" />

        {/* Kufic "الغفران" main wordmark (right to left) */}
        {/* Lam-Ghain connector & Ghain head */}
        <rect x="128" y="135" width="44" height="9" rx="1.5" fill="url(#ghufran-gold)" />
        <path
          d="M128 112h29v24h-10v-14h-19v-10Z"
          fill="url(#ghufran-gold)"
        />
        <rect x="142" y="96" width="9" height="9" rx="1.5" fill="url(#ghufran-gold)" />

        {/* Fa loop + dot/curve */}
        <path
          d="M84 112h31v32H73v-9h31v-13H94v10H84v-20Z"
          fill="url(#ghufran-gold)"
        />
        <path
          d="M96 97c2-3.5 6.5-3.5 8.5 0l-4.25 6.5L96 97Z"
          fill="url(#ghufran-gold)"
        />

        {/* Ra */}
        <path
          d="M55 112h11v46H37v-9h18v-37Z"
          fill="url(#ghufran-gold)"
        />

        {/* Alif */}
        <rect x="40" y="95" width="10" height="49" rx="1.5" fill="url(#ghufran-gold)" />

        {/* Noon + dot */}
        <path
          d="M17 120h10v28h12v10H17v-38Z"
          fill="url(#ghufran-gold)"
        />
        <rect x="27" y="104" width="9" height="9" rx="1.5" fill="url(#ghufran-gold)" />

        {/* Crisp readable Arabic title underneath */}
        <text
          x="110"
          y="194"
          textAnchor="middle"
          fill="url(#ghufran-gold)"
          fontSize="26"
          fontWeight="700"
          fontFamily='"Reem Kufi", "IBM Plex Sans Arabic", sans-serif'
        >
          مسجد الغفران
        </text>
      </svg>
    </div>
  );
}
