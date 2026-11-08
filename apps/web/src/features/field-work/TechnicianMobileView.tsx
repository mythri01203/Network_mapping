import { type FC, useEffect } from 'react';
import { useNavigate } from 'react-router';

import { useUiStore } from '../../stores/uiStore';

/**
 * The old "technician phone view" (a phone mock-up with a Mark Done button and a photo saved
 * inside the equipment list) is replaced by the job flow at `/jobs` (Phase 8): photos go to the
 * phone's own storage and upload queue, and a job closes only with a check. Anything that still
 * opens this view is sent there.
 */
export const TechnicianMobileView: FC = () => {
  const open = useUiStore((s) => s.modals.technicianMobile);
  const navigate = useNavigate();
  useEffect(() => {
    if (!open) return;
    useUiStore.getState().setModalOpen('technicianMobile', false);
    navigate('/jobs');
  }, [open, navigate]);
  return null;
};
