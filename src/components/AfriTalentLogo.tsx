import React from 'react';

interface LogoProps {
  className?: string;
  showTagline?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'default' | 'light';
}

const sizeMap = {
  sm: { w: 140, h: 40, fs: 22, is: 32 },
  md: { w: 180, h: 52, fs: 28, is: 42 },
  lg: { w: 220, h: 64, fs: 34, is: 52 },
  xl: { w: 300, h: 84, fs: 46, is: 68 },
};

export default function AfriTalentLogo({ 
  className = '', 
  showTagline = false, 
  size = 'md',
  variant = 'default'
}: LogoProps) {
  const s = sizeMap[size];
  const isLight = variant === 'light';
  const navyColor = isLight ? '#E2E8F0' : '#1E1B4B';  // Dark navy for "Afri"
  const orangeColor = '#F59E0B';  // Orange/gold for "Talent"
  const taglineColor = isLight ? '#94A3B8' : '#64748B';
  const th = s.h + (showTagline ? 14 : 0);

  // Icon dimensions
  const iconW = s.is;
  const iconH = s.is * 1.15;
  const cx = iconW / 2;
  const cy = iconH / 2;

  return (
    <div className={`inline-flex flex-col items-start ${className}`} style={{ lineHeight: 1 }}>
      <svg
        width={s.w}
        height={th}
        viewBox={`0 0 ${s.w} ${th}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="block"
        aria-label="AfriTalent"
      >
        {/* Outer ring */}
        <circle 
          cx={cx} 
          cy={cy} 
          r={s.is * 0.52} 
          fill="none" 
          stroke={orangeColor} 
          strokeWidth={s.is * 0.035}
          opacity={0.6}
        />

        {/* Africa continent shape - orange/gold */}
        <g transform={`translate(${cx - s.is * 0.42}, ${cy - s.is * 0.48})`}>
          <path
            d={`
              M${s.is * 0.25} ${s.is * 0.05}
              C${s.is * 0.35} ${s.is * 0.02}, ${s.is * 0.45} ${s.is * 0.08}, ${s.is * 0.50} ${s.is * 0.15}
              C${s.is * 0.58} ${s.is * 0.22}, ${s.is * 0.62} ${s.is * 0.32}, ${s.is * 0.58} ${s.is * 0.42}
              C${s.is * 0.55} ${s.is * 0.52}, ${s.is * 0.48} ${s.is * 0.58}, ${s.is * 0.42} ${s.is * 0.65}
              C${s.is * 0.38} ${s.is * 0.72}, ${s.is * 0.35} ${s.is * 0.82}, ${s.is * 0.30} ${s.is * 0.88}
              C${s.is * 0.25} ${s.is * 0.95}, ${s.is * 0.18} ${s.is * 0.92}, ${s.is * 0.15} ${s.is * 0.85}
              C${s.is * 0.10} ${s.is * 0.75}, ${s.is * 0.08} ${s.is * 0.62}, ${s.is * 0.12} ${s.is * 0.50}
              C${s.is * 0.15} ${s.is * 0.38}, ${s.is * 0.18} ${s.is * 0.28}, ${s.is * 0.22} ${s.is * 0.18}
              C${s.is * 0.24} ${s.is * 0.12}, ${s.is * 0.24} ${s.is * 0.08}, ${s.is * 0.25} ${s.is * 0.05}
              Z
            `}
            fill={orangeColor}
            opacity={0.95}
          />
        </g>

        {/* Network connection lines */}
        <g stroke="white" strokeWidth={s.is * 0.025} strokeLinecap="round" opacity={0.7}>
          <line x1={cx - s.is * 0.15} y1={cy - s.is * 0.22} x2={cx + s.is * 0.05} y2={cy - s.is * 0.08} />
          <line x1={cx - s.is * 0.15} y1={cy - s.is * 0.22} x2={cx - s.is * 0.08} y2={cy + s.is * 0.05} />
          <line x1={cx - s.is * 0.08} y1={cy + s.is * 0.05} x2={cx + s.is * 0.12} y2={cy + s.is * 0.15} />
          <line x1={cx + s.is * 0.05} y1={cy - s.is * 0.08} x2={cx + s.is * 0.12} y2={cy + s.is * 0.15} />
          <line x1={cx - s.is * 0.15} y1={cy - s.is * 0.22} x2={cx + s.is * 0.12} y2={cy + s.is * 0.15} />
        </g>

        {/* Network nodes - blue circles with white borders */}
        {[
          { x: cx - s.is * 0.15, y: cy - s.is * 0.22, r: s.is * 0.10 },
          { x: cx + s.is * 0.05, y: cy - s.is * 0.08, r: s.is * 0.09 },
          { x: cx - s.is * 0.08, y: cy + s.is * 0.05, r: s.is * 0.085 },
          { x: cx + s.is * 0.12, y: cy + s.is * 0.15, r: s.is * 0.095 },
          { x: cx - s.is * 0.02, y: cy - s.is * 0.18, r: s.is * 0.075 },
        ].map((node, i) => (
          <g key={i}>
            <circle cx={node.x} cy={node.y} r={node.r} fill="#3B82F6" stroke="white" strokeWidth={s.is * 0.03} />
            <circle cx={node.x} cy={node.y} r={node.r * 0.5} fill="#60A5FA" opacity={0.5} />
          </g>
        ))}

        {/* AfriTalent text - ONE WORD */}
        <text
          x={s.is + 10}
          y={s.h / 2 + s.fs * 0.32}
          fontFamily="'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif"
          fontSize={s.fs}
          fontWeight="800"
          letterSpacing="-0.01em"
          fill={navyColor}
        >
          Afri
          <tspan fill={orangeColor}>Talent</tspan>
        </text>

        {/* Tagline */}
        {showTagline && (
          <text
            x={s.is + 10}
            y={s.h + 10}
            fontFamily="'Segoe UI', system-ui, Roboto, sans-serif"
            fontSize={9}
            fontWeight="600"
            letterSpacing="0.15em"
            fill={taglineColor}
          >
            PROFESSIONAL NETWORK
          </text>
        )}
      </svg>
    </div>
  );
}
