import { equipmentArtUrl } from './equipmentArt';

export interface EquipmentIllustrationProps {
  type: string | null | undefined;
  size?: number;
  className?: string;
}

/** Decorative device illustration: the equipment's name is always shown as text beside it. */
export function EquipmentIllustration({ type, size = 32, className }: EquipmentIllustrationProps) {
  return <img src={equipmentArtUrl(type)} width={size} height={size} alt="" draggable={false} className={className} />;
}
