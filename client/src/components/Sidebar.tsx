import type { ReactNode } from 'react';

export type SidebarItem = {
  label: string;
  action: () => void;
  disabled?: boolean;
};

type SidebarProps = {
  open: boolean;
  items: SidebarItem[];
  qrDataUrl: string | null;
  onClose: () => void;
  footer?: ReactNode;
};

const Sidebar = ({ open, items, qrDataUrl, onClose, footer }: SidebarProps) => {
  return (
    <div className={`fixed right-0 top-0 z-20 h-full ${open ? 'pointer-events-auto' : 'pointer-events-none'}`}>
      {open && (
        <button
          className="fixed inset-0 z-30 cursor-default bg-transparent"
          onClick={onClose}
          aria-label="Close menu"
        />
      )}
      <div
        className={`relative z-40 h-full w-60 border-l border-neutral-800 bg-neutral-950/90 backdrop-blur ${
          open ? 'translate-x-0 pointer-events-auto' : 'translate-x-full pointer-events-none'
        } transition-transform duration-200`}
      >
        <div className="flex h-full flex-col px-4 py-10">
          <div className="space-y-1">
            {items.map((item) => (
              <button
                key={item.label}
                className={`w-full px-2 py-2 text-left text-xs uppercase tracking-widest ${
                  item.disabled ? 'text-neutral-600 cursor-not-allowed' : 'text-neutral-300 hover:bg-neutral-900'
                }`}
                onClick={() => {
                  if (!item.disabled) {
                    item.action();
                  }
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="mt-auto flex flex-col items-center justify-center gap-2 pb-6 text-xs uppercase tracking-widest text-neutral-500">
            {qrDataUrl && <img src={qrDataUrl} alt="QR code" className="h-28 w-28 opacity-90" />}
            <span>Scan to get link</span>
          </div>
          {footer}
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
