import { CircleHelp } from 'lucide-react';

import { EquipmentIllustration } from '../../components/icons/EquipmentIllustration';

/**
 * Pictures for the welcome lesson. Every one is an example drawing, labelled as such where it is
 * shown, never a record from the network. The equipment drawings are the app's own.
 */

const Tile = ({ type, label }: { type: string; label: string }) => (
  <div className="flex flex-col items-center gap-1">
    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 sm:h-20 sm:w-20">
      <EquipmentIllustration type={type} size={44} className="sm:h-[56px] sm:w-[56px]" />
    </div>
    <span className="text-[13px] font-bold text-slate-800" lang="en">
      {label}
    </span>
  </div>
);

function Collage() {
  return (
    <div className="grid grid-cols-4 gap-2" aria-hidden>
      <Tile type="OLT" label="OLT" />
      <Tile type="Telecom Pole" label="Pole" />
      <Tile type="FAT" label="Box" />
      <Tile type="ONT" label="ONT" />
    </div>
  );
}

/** A tiny pretend map: streets, two pins and a fiber line between them. */
function MiniMap({ tap }: { tap: boolean }) {
  return (
    <svg viewBox="0 0 320 160" className="h-40 w-full rounded-2xl bg-[#eef2f6] ring-1 ring-slate-200" aria-hidden>
      <path d="M0 110 H320 M0 40 H320 M90 0 V160 M230 0 V160" stroke="#fff" strokeWidth="14" />
      <path d="M0 110 H320 M0 40 H320 M90 0 V160 M230 0 V160" stroke="#d8dee6" strokeWidth="1" />
      <path d="M90 40 L230 110" stroke="#0891b2" strokeWidth="5" strokeLinecap="round" className="learn-flow" />
      <foreignObject x="62" y="10" width="56" height="56">
        <EquipmentIllustration type="Telecom Pole" size={56} />
      </foreignObject>
      <foreignObject x="202" y="80" width="56" height="56">
        <EquipmentIllustration type="FAT" size={56} />
      </foreignObject>
      {tap && <circle cx="230" cy="108" r="30" fill="none" stroke="#2563eb" strokeWidth="4" className="learn-pulse" />}
    </svg>
  );
}

/** OLT to home, with light moving along the fiber. */
function PathToHome() {
  const steps: [string, string][] = [
    ['OLT', 'OLT'],
    ['Fiber Joint Closure', 'Cable'],
    ['FAT', 'Box'],
    ['ONT', 'ONT'],
  ];
  // Tile, line, tile, line, ...: a grid, so it always fits the width (phones included).
  return (
    <div className="grid grid-cols-[auto_1fr_auto_1fr_auto_1fr_auto] items-center gap-1" aria-hidden>
      {steps.flatMap(([type, label], i) => [
        <Tile key={label} type={type} label={label} />,
        ...(i < steps.length - 1
          ? [
              <svg key={`${label}-line`} viewBox="0 0 60 8" className="mb-5 h-2 w-full" preserveAspectRatio="none">
                <line x1="0" y1="4" x2="60" y2="4" stroke="#0891b2" strokeWidth="4" strokeLinecap="round" className="learn-flow" />
              </svg>,
            ]
          : []),
      ])}
    </div>
  );
}

function HelpButtonPicture() {
  return (
    <div className="flex items-center justify-center" aria-hidden>
      <span className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg ring-4 ring-blue-200 learn-pulse">
        <CircleHelp className="h-11 w-11" />
      </span>
    </div>
  );
}

export function WelcomePicture({ lessonKey }: { lessonKey: string }) {
  switch (lessonKey) {
    case 'welcome.what':
      return <MiniMap tap={false} />;
    case 'welcome.map':
      return <MiniMap tap />;
    case 'welcome.path':
      return <PathToHome />;
    case 'welcome.again':
      return <HelpButtonPicture />;
    default:
      return <Collage />;
  }
}
