import React from 'react';
import { Megaphone } from 'lucide-react';
import { useSocialStore } from '../../stores/useSocialStore';
import { isRtlText } from '../../utils/lyricsWrapping';

export default function AnnouncementBanner() {
  const activeAnnouncement = useSocialStore((state) => state.activeAnnouncement);

  if (!activeAnnouncement || !activeAnnouncement.message) return null;

  const isRtl = isRtlText(activeAnnouncement.message);

  return (
    <div className="announcement-banner-wrapper">
      <div className={`announcement-banner-card glass ${isRtl ? 'rtl' : 'ltr'}`} dir={isRtl ? 'rtl' : 'ltr'}>
        <div className="announcement-icon-pulse">
          <Megaphone size={20} className="announcement-icon" />
        </div>
        <div className="announcement-text" dir={isRtl ? 'rtl' : 'ltr'}>
          <span className="announcement-label">Party Announcement</span>
          <span className="announcement-msg" dir="auto">{activeAnnouncement.message}</span>
        </div>
      </div>
    </div>
  );
}
