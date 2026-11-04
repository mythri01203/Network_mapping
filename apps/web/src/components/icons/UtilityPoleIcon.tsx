import React from 'react';

export interface UtilityPoleIconProps {
  className?: string;
  width?: number | string;
  height?: number | string;
  status?: 'Normal' | 'Warning' | 'Faulty' | 'Maintenance' | string;
  isSelected?: boolean;
  isTraced?: boolean;
}

export const getUtilityPoleSvgString = (
  status: string = 'Normal',
  isSelected: boolean = false,
  isTraced: boolean = false,
  width: number = 32,
  height: number = 40,
): string => {
  let badgeColor = '#10b981';
  if (status === 'Faulty') badgeColor = '#ef4444';
  else if (status === 'Warning') badgeColor = '#f59e0b';
  else if (status === 'Maintenance') badgeColor = '#8b5cf6';

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 36 44" style="overflow: visible; filter: ${
      isSelected
        ? 'drop-shadow(0 0 6px rgba(37,99,235,0.9))'
        : isTraced
          ? 'drop-shadow(0 0 6px rgba(16,185,129,0.9))'
          : 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))'
    };">
      <defs>
        <linearGradient id="poleWoodGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#5c2605" />
          <stop offset="25%" stop-color="#92400e" />
          <stop offset="60%" stop-color="#b45309" />
          <stop offset="85%" stop-color="#78350f" />
          <stop offset="100%" stop-color="#451a03" />
        </linearGradient>
        <linearGradient id="crossarmGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#b45309" />
          <stop offset="50%" stop-color="#92400e" />
          <stop offset="100%" stop-color="#5c2605" />
        </linearGradient>
        <linearGradient id="braceGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#475569" />
          <stop offset="100%" stop-color="#1e293b" />
        </linearGradient>
      </defs>

      <!-- Selection / Traced Outline Glow -->
      ${isSelected ? `<ellipse cx="18" cy="22" rx="17" ry="21" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-dasharray="3,2" />` : ''}
      ${isTraced ? `<ellipse cx="18" cy="22" rx="17" ry="21" fill="none" stroke="#10b981" stroke-width="2.5" />` : ''}

      <!-- Diagonal Support Braces under Crossarm -->
      <!-- Left Brace -->
      <path d="M 8 13.5 C 11 17, 14 20, 16.5 24" fill="none" stroke="url(#braceGrad)" stroke-width="2.2" stroke-linecap="round"/>
      <!-- Right Brace -->
      <path d="M 28 13.5 C 25 17, 22 20, 19.5 24" fill="none" stroke="url(#braceGrad)" stroke-width="2.2" stroke-linecap="round"/>
      <!-- Center brace mounting bracket ring -->
      <rect x="15.5" y="22" width="5" height="3" rx="0.5" fill="#334155" stroke="#1e293b" stroke-width="0.5"/>

      <!-- Vertical Wooden Pole Mast (Tapered from base to top) -->
      <polygon points="15.5,6 20.5,6 22,43 14,43" fill="url(#poleWoodGrad)" stroke="#451a03" stroke-width="0.8"/>
      <!-- Rounded Pole Tip -->
      <ellipse cx="18" cy="6" rx="2.5" ry="1.2" fill="#92400e" stroke="#451a03" stroke-width="0.6"/>

      <!-- Horizontal Crossarm (Crossbeam) -->
      <rect x="3" y="9.5" width="30" height="4.5" rx="1" fill="url(#crossarmGrad)" stroke="#451a03" stroke-width="0.8"/>
      <!-- Crossarm center mounting bolt -->
      <circle cx="18" cy="11.75" r="1.1" fill="#cbd5e1" stroke="#1e293b" stroke-width="0.5"/>

      <!-- Left Insulator Pin & Ceramic Bell -->
      <rect x="5.2" y="5.5" width="2.6" height="4.2" rx="0.8" fill="#0f172a" stroke="#334155" stroke-width="0.6"/>
      <ellipse cx="6.5" cy="5.5" rx="1.8" ry="0.9" fill="#38bdf8"/>
      <line x1="6.5" y1="9.7" x2="6.5" y2="10.5" stroke="#475569" stroke-width="1"/>

      <!-- Right Insulator Pin & Ceramic Bell -->
      <rect x="28.2" y="5.5" width="2.6" height="4.2" rx="0.8" fill="#0f172a" stroke="#334155" stroke-width="0.6"/>
      <ellipse cx="29.5" cy="5.5" rx="1.8" ry="0.9" fill="#38bdf8"/>
      <line x1="29.5" y1="9.7" x2="29.5" y2="10.5" stroke="#475569" stroke-width="1"/>

      <!-- Center Top Insulator Pin & Cap -->
      <rect x="16.7" y="1.8" width="2.6" height="4.2" rx="0.8" fill="#0f172a" stroke="#334155" stroke-width="0.6"/>
      <ellipse cx="18" cy="1.8" rx="1.8" ry="0.9" fill="#38bdf8"/>

      <!-- Live Status Badge (Top Right) -->
      <circle cx="31" cy="4" r="3.2" fill="${badgeColor}" stroke="#ffffff" stroke-width="1.2"/>
    </svg>
  `;
};

export const UtilityPoleIcon: React.FC<UtilityPoleIconProps> = ({
  className = '',
  width = 32,
  height = 40,
  status = 'Normal',
  isSelected = false,
  isTraced = false,
}) => {
  const svgHtml = getUtilityPoleSvgString(status, isSelected, isTraced, Number(width) || 32, Number(height) || 40);
  return (
    <div
      className={`inline-flex items-center justify-center shrink-0 ${className}`}
      dangerouslySetInnerHTML={{ __html: svgHtml }}
    />
  );
};
