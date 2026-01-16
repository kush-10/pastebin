type ShortcutsModalProps = {
  open: boolean;
  modKey: string;
  onClose: () => void;
};

const ShortcutsModal = ({ open, modKey, onClose }: ShortcutsModalProps) => {
  if (!open) return null;
  const keyClass = 'rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs';
  const spaceClass =
    'inline-flex min-w-[2.75rem] items-center justify-center rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-[10px] uppercase tracking-widest text-neutral-400';

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-xl max-h-[90vh] rounded-lg border border-neutral-800 bg-neutral-950 p-6 space-y-4">
        <div className="text-xs uppercase tracking-widest text-neutral-400">Shortcuts</div>
        <div className="grid gap-6 text-sm text-neutral-300 md:grid-cols-2">
          <div className="space-y-3">
            <div className="text-xs uppercase tracking-widest text-neutral-500">App shortcuts</div>
            <div className="flex items-center justify-between">
              <span>Toggle menu</span>
              <span className="flex gap-1">
                <kbd className={keyClass}>{modKey}</kbd>
                <kbd className={keyClass}>k</kbd>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Save</span>
              <span className="flex gap-1">
                <kbd className={keyClass}>{modKey}</kbd>
                <kbd className={keyClass}>s</kbd>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Show shortcuts</span>
              <span className="flex gap-1">
                <kbd className={keyClass}>{modKey}</kbd>
                <kbd className={keyClass}>/</kbd>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Set password</span>
              <span className="flex gap-1">
                <kbd className={keyClass}>{modKey}</kbd>
                <kbd className={keyClass}>shift</kbd>
                <kbd className={keyClass}>p</kbd>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Set expiry</span>
              <span className="flex gap-1">
                <kbd className={keyClass}>{modKey}</kbd>
                <kbd className={keyClass}>shift</kbd>
                <kbd className={keyClass}>e</kbd>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>New doc</span>
              <span className="flex gap-1">
                <kbd className={keyClass}>{modKey}</kbd>
                <kbd className={keyClass}>.</kbd>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Text size up</span>
              <span className="flex gap-1">
                <kbd className={keyClass}>{modKey}</kbd>
                <kbd className={keyClass}>=</kbd>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Text size down</span>
              <span className="flex gap-1">
                <kbd className={keyClass}>{modKey}</kbd>
                <kbd className={keyClass}>-</kbd>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Text size reset</span>
              <span className="flex gap-1">
                <kbd className={keyClass}>{modKey}</kbd>
                <kbd className={keyClass}>0</kbd>
              </span>
            </div>
          </div>
          <div className="space-y-3">
            <div className="text-xs uppercase tracking-widest text-neutral-500">Markdown shortcuts</div>
            <div className="flex items-center justify-between">
              <span>Heading 1</span>
              <span className="flex gap-1">
                <kbd className={keyClass}>#</kbd>
                <kbd className={spaceClass}>Space</kbd>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Heading 2</span>
              <span className="flex gap-1">
                <kbd className={keyClass}>##</kbd>
                <kbd className={spaceClass}>Space</kbd>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Heading 3</span>
              <span className="flex gap-1">
                <kbd className={keyClass}>###</kbd>
                <kbd className={spaceClass}>Space</kbd>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Bold</span>
              <span className="flex gap-1">
                <kbd className={keyClass}>{modKey}</kbd>
                <kbd className={keyClass}>b</kbd>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Italics</span>
              <span className="flex gap-1">
                <kbd className={keyClass}>{modKey}</kbd>
                <kbd className={keyClass}>i</kbd>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Underline</span>
              <span className="flex gap-1">
                <kbd className={keyClass}>{modKey}</kbd>
                <kbd className={keyClass}>u</kbd>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Bullet list</span>
              <span className="flex gap-1">
                <kbd className={keyClass}>-</kbd>
                <kbd className={spaceClass}>Space</kbd>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Ordered list</span>
              <span className="flex gap-1">
                <kbd className={keyClass}>1.</kbd>
                <kbd className={spaceClass}>Space</kbd>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Inline code</span>
              <span className="flex gap-1">
                <kbd className={keyClass}>`</kbd>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Code block</span>
              <span className="flex gap-1">
                <kbd className={keyClass}>```</kbd>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Link</span>
              <span className="flex gap-1">
                <kbd className={keyClass}>{modKey}</kbd>
                <kbd className={keyClass}>shift</kbd>
                <kbd className={keyClass}>l</kbd>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Blockquote</span>
              <span className="flex gap-1">
                <kbd className={keyClass}>&gt;</kbd>
                <kbd className={spaceClass}>Space</kbd>
              </span>
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <button
            className="rounded-md border border-neutral-700 px-3 py-2 text-xs uppercase tracking-widest text-neutral-200"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ShortcutsModal;
