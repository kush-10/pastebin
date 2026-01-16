type TextScaleControlProps = {
  scale: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
};

const TextScaleControl = ({ scale, min, max, step, onChange }: TextScaleControlProps) => {
  const percent = Math.round(scale * 100);

  return (
    <div className="text-scale-slider" role="group" aria-label="Text size">
      <div className="text-scale-value" aria-live="polite">{percent}%</div>
      <input
        className="text-scale-input"
        type="range"
        min={min}
        max={max}
        step={step}
        value={scale}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label="Text size"
      />
    </div>
  );
};

export default TextScaleControl;
