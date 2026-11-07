import type { BoxKind, PoleMaterial, PoleOwnerType } from '@fibergis/shared';

import { equipmentArtUrl } from '../../components/icons/equipmentArt';
import type { MessageKey } from '../../i18n/messages';

/**
 * The picture questions, as data. To use photos of this operator's own hardware, put the files in
 * `apps/web/public/field-pictures/` and set `picture` to `/field-pictures/<file>.jpg`; nothing else
 * changes. Every question has a "Don't know" answer, so nobody is forced to guess.
 */
export interface ChoiceOption<V extends string> {
  value: V;
  label: MessageKey;
  /** Image URL: an illustration today, replaceable by a real photo. */
  picture: string;
}

export interface ChoiceQuestion<V extends string> {
  id: 'owner' | 'material' | 'boxKind';
  question: MessageKey;
  options: ChoiceOption<V>[];
}

const svg = (body: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`)}`;

/** A plain pole drawn in one material, for the material question. */
const polePicture = (fill: string, stripe: string) =>
  svg(
    `<rect x="0" y="58" width="64" height="6" fill="#94a3b8"/><rect x="26" y="4" width="12" height="56" rx="2" fill="${fill}"/>` +
      `<rect x="26" y="4" width="4" height="56" fill="${stripe}" opacity=".45"/><rect x="18" y="12" width="28" height="4" rx="1" fill="#334155"/>`,
  );

const UNKNOWN_PICTURE = svg(
  '<circle cx="32" cy="32" r="28" fill="#fff" stroke="#0f172a" stroke-width="4"/>' +
    '<path d="M24 25a8 8 0 1 1 11 7.4c-2 .8-3 2.2-3 4.3V40" fill="none" stroke="#0f172a" stroke-width="5" stroke-linecap="round"/>' +
    '<circle cx="32" cy="49" r="3.5" fill="#0f172a"/>',
);

export const OWNER_QUESTION: ChoiceQuestion<PoleOwnerType> = {
  id: 'owner',
  question: 'q.owner',
  options: [
    { value: 'telecom', label: 'q.owner.telecom', picture: equipmentArtUrl('Telecom Pole') },
    { value: 'electricity', label: 'q.owner.electricity', picture: equipmentArtUrl('Electric Pole') },
    { value: 'unknown', label: 'choice.unknown', picture: UNKNOWN_PICTURE },
  ],
};

export const MATERIAL_QUESTION: ChoiceQuestion<PoleMaterial> = {
  id: 'material',
  question: 'q.material',
  options: [
    { value: 'concrete', label: 'q.material.concrete', picture: polePicture('#a8a29e', '#f5f5f4') },
    { value: 'iron', label: 'q.material.iron', picture: polePicture('#334155', '#94a3b8') },
    { value: 'wood', label: 'q.material.wood', picture: polePicture('#92400e', '#fbbf24') },
    { value: 'unknown', label: 'choice.unknown', picture: UNKNOWN_PICTURE },
  ],
};

export const BOX_QUESTION: ChoiceQuestion<BoxKind> = {
  id: 'boxKind',
  question: 'q.box',
  options: [
    { value: 'street_box', label: 'q.box.street_box', picture: equipmentArtUrl('Pole-Mounted Terminal Box') },
    { value: 'joint_box', label: 'q.box.joint_box', picture: equipmentArtUrl('Fiber Joint Closure') },
    { value: 'unknown', label: 'choice.unknown', picture: UNKNOWN_PICTURE },
  ],
};

/** Home tile pictures. */
export const TILE_PICTURES = {
  pole: equipmentArtUrl('Telecom Pole'),
  box: equipmentArtUrl('Pole-Mounted Terminal Box'),
  drop: equipmentArtUrl('Building Entry Point'),
  light: equipmentArtUrl('Optical Instrument'),
  danger: svg(
    '<path d="M32 4 62 58H2z" fill="#991b1b"/><path d="M32 14 54 54H10z" fill="#fde047"/>' +
      '<path d="M35 22 26 40h7l-4 12 12-18h-7l4-12z" fill="#0f172a"/>',
  ),
} as const;
