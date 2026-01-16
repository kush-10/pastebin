type LinkModalProps = {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
};

const LinkModal = ({ open, value, onChange, onSave, onClose }: LinkModalProps) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-sm rounded-lg border border-neutral-800 bg-neutral-950 p-6 space-y-4">
        <div className="text-xs uppercase tracking-widest text-neutral-400">Insert link</div>
        <input
          type="url"
          placeholder="https://example.com"
          className="w-full rounded-md bg-neutral-900 border border-neutral-700 px-3 py-2 text-sm text-white"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onSave();
            }
          }}
          autoFocus
        />
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

export default LinkModal;
