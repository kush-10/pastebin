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
  leftActions?: ReactNode;
  rightActions?: ReactNode;
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
  leftActions,
  rightActions,
  className
}: StatusHudProps) => {
  return (
    <div className={`flex items-center justify-between gap-4 ${className ?? ''}`}>
      <div className="flex items-center gap-2 text-xs text-neutral-500">
        {leftActions && <div className="flex items-center gap-0">{leftActions}</div>}
        <div className="flex items-center gap-2">
          {hasPassword && passwordSet && (
            <span className="inline-flex h-8 w-8 items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
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
          {expiresAt && <span>Expires {new Date(expiresAt).toLocaleString()}</span>}
          <span>{saving ? 'Saving…' : savedAt ? `Saved ${savedAt}` : ''}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {rightActions}
        {scaleControl}
        {onMenuToggle && (
          <button
            className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-200"
            onClick={(event) => {
              event.stopPropagation();
              onMenuToggle();
            }}
            type="button"
            aria-label="Toggle menu"
          >
            <span className="relative h-4 w-4">
              <span
                className={`absolute left-0 top-0 block h-0.5 w-4 rounded-full bg-current transition-transform duration-200 ${
                  menuOpen ? 'translate-y-1.5 rotate-45' : ''
                }`}
              />
              <span
                className={`absolute left-0 top-1.5 block h-0.5 w-4 rounded-full bg-current transition-opacity duration-200 ${
                  menuOpen ? 'opacity-0' : 'opacity-100'
                }`}
              />
              <span
                className={`absolute left-0 top-3 block h-0.5 w-4 rounded-full bg-current transition-transform duration-200 ${
                  menuOpen ? '-translate-y-1.5 -rotate-45' : ''
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
