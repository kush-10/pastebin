type ExpiryModalProps = {
  open: boolean;
  expiryPreset: string;
  customExpiry: string;
  onPresetChange: (value: string) => void;
  onCustomChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
};

const ExpiryModal = ({
  open,
  expiryPreset,
  customExpiry,
  onPresetChange,
  onCustomChange,
  onSave,
  onClose
}: ExpiryModalProps) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/70"
      onClick={onClose}
      role="button"
      tabIndex={-1}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-neutral-800 bg-neutral-950 p-6 space-y-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="text-xs uppercase tracking-widest text-neutral-400">Set expiry</div>
        <select
          className="w-full rounded-md bg-neutral-900 border border-neutral-700 px-3 py-2 text-sm text-white"
          value={expiryPreset}
          onChange={(event) => onPresetChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onSave();
            }
          }}
        >
          <option value="10m">10 minutes</option>
          <option value="1h">1 hour</option>
          <option value="1d">1 day</option>
          <option value="1w">1 week</option>
          <option value="custom">Custom datetime</option>
        </select>
        {expiryPreset === 'custom' && (
          <input
            type="datetime-local"
            className="w-full rounded-md bg-neutral-900 border border-neutral-700 px-3 py-2 text-sm text-white"
            value={customExpiry}
            onChange={(event) => onCustomChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onSave();
              }
            }}
          />
        )}
        <div className="flex gap-3">
          <button
            className="rounded-md border border-neutral-700 px-3 py-2 text-xs uppercase tracking-widest text-neutral-200"
            onClick={onSave}
          >
            Save
          </button>
          <button
            className="rounded-md border border-transparent px-3 py-2 text-xs uppercase tracking-widest text-neutral-500"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExpiryModal;
