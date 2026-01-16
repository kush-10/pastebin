import type { ReactNode } from 'react';

type StatusHudProps = {
  saving: boolean;
  savedAt: string | null;
  expiresAt: string | null;
  hasPassword: boolean;
  passwordSet: boolean;
  menuOpen?: boolean;
  onMenuToggle?: () => void;
  scaleControl?: ReactNode;
  className?: string;
};

const StatusHud = ({
  saving,
  savedAt,
  expiresAt,
  hasPassword,
  passwordSet,
  menuOpen = false,
  onMenuToggle,
  scaleControl,
  className
}: StatusHudProps) => {
  return (
    <div className={`flex items-center justify-between gap-4 ${className ?? ''}`}>
      <div className="flex items-center gap-2 text-xs text-neutral-500">
        {hasPassword && passwordSet && (
          <span className="inline-flex items-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d="M7 10V7a5 5 0 0 1 9.9-1"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </span>
        )}
        <span>{saving ? 'Saving…' : savedAt ? `Saved ${savedAt}` : ''}</span>
        {expiresAt && <span>Expires {new Date(expiresAt).toLocaleString()}</span>}
      </div>
      <div className="flex items-center gap-2">
        {scaleControl}
        {onMenuToggle && (
          <button
            className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900 text-neutral-200"
            onClick={(event) => {
              event.stopPropagation();
              onMenuToggle();
            }}
            type="button"
            aria-label="Toggle menu"
          >
            <span className="relative h-4 w-4">
              <span
                className={`absolute left-0 top-0 block h-[2px] w-4 rounded-full bg-current transition-transform duration-200 ${
                  menuOpen ? 'translate-y-[6px] rotate-45' : ''
                }`}
              />
              <span
                className={`absolute left-0 top-[6px] block h-[2px] w-4 rounded-full bg-current transition-opacity duration-200 ${
                  menuOpen ? 'opacity-0' : 'opacity-100'
                }`}
              />
              <span
                className={`absolute left-0 top-[12px] block h-[2px] w-4 rounded-full bg-current transition-transform duration-200 ${
                  menuOpen ? 'translate-y-[-6px] -rotate-45' : ''
                }`}
              />
            </span>
          </button>
        )}
      </div>
    </div>
  );
};

export default StatusHud;
