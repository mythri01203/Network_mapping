import React from 'react';

export interface OltChassisIconProps {
  className?: string;
  width?: number | string;
  height?: number | string;
  status?: 'Normal' | 'Warning' | 'Faulty' | 'Maintenance' | string;
  isSelected?: boolean;
  isTraced?: boolean;
  technology?: string;
}

export const getOltChassisSvgString = (
  status: string = 'Normal',
  isSelected: boolean = false,
  isTraced: boolean = false,
  width: number = 54,
  height: number = 28,
  technology?: string
): string => {
  let badgeColor = '#10b981';
  if (status === 'Faulty') badgeColor = '#ef4444';
  else if (status === 'Warning') badgeColor = '#f59e0b';
  else if (status === 'Maintenance') badgeColor = '#8b5cf6';

  const outline = isSelected
    ? `stroke="#2563eb" stroke-width="2.5" stroke-dasharray="3,2"`
    : isTraced
    ? `stroke="#10b981" stroke-width="2.5"`
    : `stroke="#334155" stroke-width="0.8"`;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 58 30" style="overflow: visible; filter: ${isSelected ? 'drop-shadow(0 0 6px rgba(37,99,235,0.9))' : isTraced ? 'drop-shadow(0 0 6px rgba(16,185,129,0.9))' : 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))'};">
      <defs>
        <linearGradient id="oltChassisGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#2a3d54" />
          <stop offset="100%" stop-color="#141e2b" />
        </linearGradient>
        <linearGradient id="bladePlateGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#e2e8f0" />
          <stop offset="100%" stop-color="#94a3b8" />
        </linearGradient>
      </defs>

      <!-- Selection / Traced Outline Box -->
      ${isSelected || isTraced ? `<rect x="-1" y="-1" width="60" height="32" rx="4" fill="none" ${outline} />` : ''}

      <!-- Left Rack Mounting Ear with screw holes -->
      <rect x="1" y="3" width="3.5" height="23" rx="0.8" fill="#1e293b" stroke="#475569" stroke-width="0.6"/>
      <circle cx="2.75" cy="6.5" r="0.8" fill="#cbd5e1" stroke="#0f172a" stroke-width="0.3"/>
      <circle cx="2.75" cy="14.5" r="0.8" fill="#cbd5e1" stroke="#0f172a" stroke-width="0.3"/>
      <circle cx="2.75" cy="22.5" r="0.8" fill="#cbd5e1" stroke="#0f172a" stroke-width="0.3"/>

      <!-- Right Rack Mounting Ear with screw holes -->
      <rect x="53.5" y="3" width="3.5" height="23" rx="0.8" fill="#1e293b" stroke="#475569" stroke-width="0.6"/>
      <circle cx="55.25" cy="6.5" r="0.8" fill="#cbd5e1" stroke="#0f172a" stroke-width="0.3"/>
      <circle cx="55.25" cy="14.5" r="0.8" fill="#cbd5e1" stroke="#0f172a" stroke-width="0.3"/>
      <circle cx="55.25" cy="22.5" r="0.8" fill="#cbd5e1" stroke="#0f172a" stroke-width="0.3"/>

      <!-- Main Chassis Housing -->
      <rect x="4" y="2" width="50" height="25" rx="1.8" fill="url(#oltChassisGrad)" stroke="#0f172a" stroke-width="1.2"/>

      <!-- Left Control Panel Area -->
      <rect x="5.5" y="3.5" width="10.5" height="15.5" rx="0.8" fill="#0f172a" fill-opacity="0.6"/>
      <text x="10.7" y="9.8" font-family="system-ui, -apple-system, sans-serif" font-size="5.2" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="0.4">OLT</text>
      <!-- 4 Status LEDs (Green, Green, Yellow, Red) -->
      <circle cx="7.5" cy="13" r="0.8" fill="#10b981"/>
      <circle cx="9.5" cy="13" r="0.8" fill="#10b981"/>
      <circle cx="11.5" cy="13" r="0.8" fill="#f59e0b"/>
      <circle cx="13.5" cy="13" r="0.8" fill="${status === 'Faulty' ? '#ef4444' : '#64748b'}"/>

      <!-- Slot 1 Blade (Top) -->
      <rect x="17" y="3.5" width="35.5" height="4.4" rx="0.6" fill="url(#bladePlateGrad)" stroke="#475569" stroke-width="0.4"/>
      <circle cx="19" cy="5.7" r="0.5" fill="#10b981"/>
      <!-- SFP Port cutouts -->
      <rect x="20.5" y="4.6" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <rect x="23.3" y="4.6" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <rect x="26.1" y="4.6" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <circle cx="29.5" cy="5.7" r="0.5" fill="#10b981"/>
      <rect x="31" y="4.6" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <rect x="33.8" y="4.6" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <rect x="36.6" y="4.6" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <rect x="39.4" y="4.6" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <rect x="42.2" y="4.6" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <rect x="45" y="4.6" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <rect x="47.8" y="4.6" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <rect x="50.8" y="4.3" width="1.2" height="2.8" rx="0.3" fill="#cbd5e1" stroke="#64748b" stroke-width="0.2"/>

      <!-- Slot 2 Blade (Middle) -->
      <rect x="17" y="8.8" width="35.5" height="4.4" rx="0.6" fill="url(#bladePlateGrad)" stroke="#475569" stroke-width="0.4"/>
      <circle cx="19" cy="11" r="0.5" fill="#10b981"/>
      <rect x="20.5" y="9.9" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <rect x="23.3" y="9.9" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <rect x="26.1" y="9.9" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <circle cx="29.5" cy="11" r="0.5" fill="#10b981"/>
      <rect x="31" y="9.9" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <rect x="33.8" y="9.9" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <rect x="36.6" y="9.9" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <rect x="39.4" y="9.9" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <rect x="42.2" y="9.9" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <rect x="45" y="9.9" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <rect x="47.8" y="9.9" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <rect x="50.8" y="9.6" width="1.2" height="2.8" rx="0.3" fill="#cbd5e1" stroke="#64748b" stroke-width="0.2"/>

      <!-- Slot 3 Blade (Bottom) -->
      <rect x="17" y="14.1" width="35.5" height="4.4" rx="0.6" fill="url(#bladePlateGrad)" stroke="#475569" stroke-width="0.4"/>
      <circle cx="19" cy="16.3" r="0.5" fill="#10b981"/>
      <rect x="20.5" y="15.2" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <rect x="23.3" y="15.2" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <rect x="26.1" y="15.2" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <circle cx="29.5" cy="16.3" r="0.5" fill="#10b981"/>
      <rect x="31" y="15.2" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <rect x="33.8" y="15.2" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <rect x="36.6" y="15.2" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <rect x="39.4" y="15.2" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <rect x="42.2" y="15.2" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <rect x="45" y="15.2" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <rect x="47.8" y="15.2" width="2" height="2.2" rx="0.2" fill="#0f172a"/>
      <rect x="50.8" y="14.9" width="1.2" height="2.8" rx="0.3" fill="#cbd5e1" stroke="#64748b" stroke-width="0.2"/>

      <!-- Lower Ventilation & Power Section -->
      <rect x="5.5" y="19.8" width="47" height="6.2" rx="0.6" fill="#0b1118"/>
      <!-- Ventilation slots / dots -->
      <circle cx="8" cy="22.9" r="0.55" fill="#334155"/>
      <circle cx="10" cy="22.9" r="0.55" fill="#334155"/>
      <circle cx="12" cy="22.9" r="0.55" fill="#334155"/>
      <circle cx="14" cy="22.9" r="0.55" fill="#334155"/>
      <circle cx="16" cy="22.9" r="0.55" fill="#334155"/>
      <circle cx="18" cy="22.9" r="0.55" fill="#334155"/>
      <!-- Power connector -->
      <rect x="22" y="21.3" width="4.5" height="3.2" rx="0.4" fill="#1e293b" stroke="#475569" stroke-width="0.4"/>
      <circle cx="23.5" cy="22.9" r="0.5" fill="#0f172a"/>
      <circle cx="25" cy="22.9" r="0.5" fill="#0f172a"/>
      <!-- Right vents -->
      <circle cx="30" cy="22.9" r="0.55" fill="#334155"/>
      <circle cx="32" cy="22.9" r="0.55" fill="#334155"/>
      <circle cx="34" cy="22.9" r="0.55" fill="#334155"/>
      <circle cx="36" cy="22.9" r="0.55" fill="#334155"/>
      <circle cx="38" cy="22.9" r="0.55" fill="#334155"/>
      <circle cx="40" cy="22.9" r="0.55" fill="#334155"/>
      <circle cx="42" cy="22.9" r="0.55" fill="#334155"/>
      <circle cx="44" cy="22.9" r="0.55" fill="#334155"/>
      <circle cx="46" cy="22.9" r="0.55" fill="#334155"/>
      <circle cx="48" cy="22.9" r="0.55" fill="#334155"/>
      <circle cx="50" cy="22.9" r="0.55" fill="#334155"/>

      <!-- Live Status Badge (Top Right) -->
      <circle cx="53" cy="2" r="3.2" fill="${badgeColor}" stroke="#ffffff" stroke-width="1.2"/>

      <!-- Technology Tag (GPON = Blue, EPON = Purple) -->
      ${technology ? `
        <g transform="translate(18, -4.5)">
          <rect x="0" y="0" width="${technology === 'Combo PON' ? 26 : 17}" height="8" rx="2" fill="${technology === 'EPON' ? '#9333ea' : '#2563eb'}" stroke="#ffffff" stroke-width="0.9" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.4))"/>
          <text x="${technology === 'Combo PON' ? 13 : 8.5}" y="5.6" font-family="system-ui, -apple-system, sans-serif" font-size="4.6" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="0.3">${technology}</text>
        </g>
      ` : ''}
    </svg>
  `;
};

export const OltChassisIcon: React.FC<OltChassisIconProps> = ({
  className = '',
  width = 54,
  height = 28,
  status = 'Normal',
  isSelected = false,
  isTraced = false,
  technology
}) => {
  const svgHtml = getOltChassisSvgString(
    status,
    isSelected,
    isTraced,
    Number(width) || 54,
    Number(height) || 28,
    technology
  );
  return (
    <div
      className={`inline-flex items-center justify-center shrink-0 ${className}`}
      dangerouslySetInnerHTML={{ __html: svgHtml }}
    />
  );
};

