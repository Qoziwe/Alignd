import ooppssieMaskot from '../../assets/ooppssieMaskot.png';

type UpseeProps = {
  mood?: 'sleeping' | 'thinking';
  size?: number;
  className?: string;
};

export default function Upsee({mood = 'thinking', size = 90, className = ''}: UpseeProps) {
  return (
    <div
      className={`relative flex items-center justify-center ${className}`}
      style={{height: size, width: size}}
      aria-label={`Upsee ${mood}`}
    >
      <img src={ooppssieMaskot} alt="" className="h-full w-full object-contain opacity-90" />
      {mood === 'sleeping' && (
        <span className="absolute right-1 top-1 text-[18px] font-bold text-[var(--color-text-muted)]" aria-hidden="true">
          zzz
        </span>
      )}
    </div>
  );
}
