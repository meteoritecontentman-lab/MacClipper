import React, { useId } from 'react';

function BrandMark({ className = '', title = 'MacClipper' }) {
  const clipPathId = useId();

  return (
    <svg
      className={`brand-mark-svg ${className}`.trim()}
      viewBox="0 0 100 100"
      role="img"
      aria-label={title}
    >
      <defs>
        <clipPath id={clipPathId}>
          <rect x="6" y="6" width="88" height="88" rx="20" ry="20" />
        </clipPath>
      </defs>

      <rect x="6" y="6" width="88" height="88" rx="20" ry="20" fill="#1c242b" />
      <rect x="6" y="6" width="88" height="88" rx="20" ry="20" fill="none" stroke="rgba(255,255,255,0.08)" />

      <g clipPath={`url(#${clipPathId})`}>
        <path d="M6 6 H74 L49 50 L6 61.5 Z" fill="#2e6d61" />
        <path d="M33 94 H94 V47 L55 30 Z" fill="#db6b3d" />
        <ellipse cx="49" cy="54" rx="38" ry="36" fill="#ffffff" opacity="0.06" />
      </g>

      <path
        d="M29 39.5 V70.5 H59 M41 30.5 H71 V59.5"
        fill="none"
        stroke="#f7edde"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M39.5 26 H52.5 L65 59 H52 Z"
        fill="#e6ca8f"
        stroke="rgba(255,255,255,0.22)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default BrandMark;