// Iconos del panel: mismo trazo y misma rejilla de 24 que el v1 (portados de
// admin-panel.js y admin-page.js). Los logos de canal llevan el color por clase — la
// paleta del panel, no la de la marca, para que no chillen dentro de la vista.
import type { ConvChannel } from '../api/types';

export const CH_LABEL: Record<string, string> = {
  web: 'Web',
  whatsapp: 'WhatsApp',
  messenger: 'Messenger',
  instagram: 'Instagram',
  telegram: 'Telegram',
};

const CH_CLS: Record<string, string> = {
  whatsapp: 'ch-wa',
  web: 'ch-web',
  messenger: 'ch-ms',
  instagram: 'ch-ig',
  telegram: 'ch-tg',
};

function chPaths(ch: ConvChannel) {
  switch (ch) {
    case 'whatsapp':
      return (
        <>
          <path d="M12 3.2a8.8 8.8 0 0 0-7.5 13.4L3.2 20.8l4.4-1.3A8.8 8.8 0 1 0 12 3.2z" />
          <path d="M9.3 9.1l1 1.8-.9.9a6.2 6.2 0 0 0 2.8 2.8l.9-.9 1.8 1" />
        </>
      );
    case 'web':
      return (
        <>
          <circle cx="12" cy="12" r="8.6" />
          <path d="M3.4 12h17.2" />
          <path d="M12 3.4c3.2 3.7 3.2 13.5 0 17.2c-3.2-3.7-3.2-13.5 0-17.2" />
        </>
      );
    case 'messenger':
      return (
        <>
          <path d="M12 3.2c-4.85 0-8.8 3.63-8.8 8.13 0 2.55 1.28 4.82 3.28 6.32v3.15l3.02-1.65c.79.21 1.63.33 2.5.33 4.85 0 8.8-3.63 8.8-8.15S16.85 3.2 12 3.2z" />
          <path d="M7.5 14.4l2.7-4.3 2.4 1.9 2.4-3.2" />
        </>
      );
    case 'instagram':
      return (
        <>
          <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="16.9" cy="7.1" r="1.15" fill="currentColor" stroke="none" />
        </>
      );
    case 'telegram':
      return (
        <>
          <path d="M21.3 4.4 2.9 11.2c-.9.3-.9 1.6.1 1.8l4.4 1.1 1.6 4.7c.3.9 1.5.9 2 .2l2.1-3.1 4 3c.7.5 1.7.2 1.9-.7l2.9-12.5c.2-.9-.7-1.6-1.6-1.3z" />
          <path d="M8.6 14.3 18 7.4" />
        </>
      );
  }
}

export function ChIcon({ ch }: { ch: ConvChannel }) {
  return (
    <svg
      className={CH_CLS[ch] ?? ''}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {chPaths(ch)}
    </svg>
  );
}

interface IconProps {
  strokeWidth?: number;
}

function Icon({ strokeWidth = 1.7, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IcoDashboard = () => (
  <Icon>
    <rect x="3" y="12" width="4" height="9" />
    <rect x="10" y="7" width="4" height="14" />
    <rect x="17" y="3" width="4" height="18" />
  </Icon>
);
export const IcoLeads = () => (
  <Icon>
    <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
    <circle cx="10" cy="7" r="4" />
    <path d="M21 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </Icon>
);
export const IcoChat = () => (
  <Icon>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </Icon>
);
export const IcoCalendar = () => (
  <Icon>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <line x1="8" y1="3" x2="8" y2="7" />
    <line x1="16" y1="3" x2="16" y2="7" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </Icon>
);
export const IcoLink = () => (
  <Icon>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </Icon>
);
export const IcoBriefcase = () => (
  <Icon>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </Icon>
);
export const IcoChannels = () => (
  <Icon>
    <path d="M4 7h10" />
    <circle cx="18" cy="7" r="2.4" />
    <path d="M4 17h10" />
    <circle cx="18" cy="17" r="2.4" />
    <path d="M4 12h6" />
  </Icon>
);
export const IcoSliders = () => (
  <Icon>
    <line x1="4" y1="7" x2="20" y2="7" />
    <circle cx="9" cy="7" r="2.4" />
    <line x1="4" y1="17" x2="20" y2="17" />
    <circle cx="15" cy="17" r="2.4" />
  </Icon>
);
export const IcoClock = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 7 12 12 15.5 14" />
  </Icon>
);
export const IcoTemplate = () => (
  <Icon>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="13" y2="17" />
  </Icon>
);
export const IcoMoon = () => (
  <Icon>
    <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
  </Icon>
);
export const IcoSun = () => (
  <Icon>
    <circle cx="12" cy="12" r="4.5" />
    <line x1="12" y1="2.5" x2="12" y2="5" />
    <line x1="12" y1="19" x2="12" y2="21.5" />
    <line x1="2.5" y1="12" x2="5" y2="12" />
    <line x1="19" y1="12" x2="21.5" y2="12" />
    <line x1="5.3" y1="5.3" x2="7" y2="7" />
    <line x1="17" y1="17" x2="18.7" y2="18.7" />
    <line x1="5.3" y1="18.7" x2="7" y2="17" />
    <line x1="17" y1="7" x2="18.7" y2="5.3" />
  </Icon>
);
export const IcoLogout = () => (
  <Icon>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </Icon>
);
export const IcoSearch = () => (
  <Icon>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </Icon>
);
export const IcoSend = () => (
  <Icon strokeWidth={2.2}>
    <path d="M5 12h13" />
    <path d="m12.5 5.5 6.5 6.5-6.5 6.5" />
  </Icon>
);
export const IcoBack = () => (
  <Icon strokeWidth={2}>
    <path d="m14.5 6-6 6 6 6" />
  </Icon>
);
export const IcoDownload = () => (
  <Icon>
    <path d="M12 3v12" />
    <path d="m7 11 5 5 5-5" />
    <path d="M4 20h16" />
  </Icon>
);
export const IcoKey = () => (
  <Icon strokeWidth={1.8}>
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
  </Icon>
);
export const IcoCloud = () => (
  <Icon strokeWidth={1.8}>
    <path d="M17.5 19a4.5 4.5 0 1 0-.42-8.98 6 6 0 1 0-11.4 2.38A3.5 3.5 0 0 0 6.5 19h11z" />
  </Icon>
);
export const IcoShield = () => (
  <Icon strokeWidth={1.8}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);
export const IcoLock = () => (
  <Icon strokeWidth={1.8}>
    <rect x="3" y="11" width="18" height="10" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Icon>
);
export const IcoDb = () => (
  <Icon strokeWidth={1.8}>
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
    <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
  </Icon>
);
export const IcoPen = () => (
  <Icon strokeWidth={1.8}>
    <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
    <path d="m14.5 5.5 3 3" />
  </Icon>
);
export const IcoX = () => (
  <Icon strokeWidth={2}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Icon>
);
export const IcoTick = () => (
  <Icon strokeWidth={2.4}>
    <polyline points="20 6 9 17 4 12" />
  </Icon>
);
export const IcoBell = () => (
  <Icon>
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </Icon>
);
export const IcoChevronDown = () => (
  <Icon strokeWidth={2.2}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);
