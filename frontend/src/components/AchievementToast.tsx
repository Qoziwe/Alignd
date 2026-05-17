import {Clapperboard, SearchCheck, Target} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';

type AchievementToastProps = {
  achievement: {
    label: string;
    icon: string;
  } | null;
};

const achievementIcons: Record<string, LucideIcon> = {
  'search-check': SearchCheck,
  target: Target,
  clapperboard: Clapperboard,
};

export default function AchievementToast({achievement}: AchievementToastProps) {
  if (!achievement) {
    return null;
  }

  const Icon = achievementIcons[achievement.icon] || Target;

  return (
    <div
      className="fixed bottom-[90px] right-6 z-[999] max-w-[320px] animate-[achievement-toast-in_0.4s_ease-out] rounded-[16px] border border-[rgba(232,64,168,0.4)] bg-[var(--color-background-elevated)] px-[18px] py-[14px] shadow-[0_20px_60px_rgba(0,0,0,0.35)]"
    >
      <style>
        {`@keyframes achievement-toast-in{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}`}
      </style>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[rgba(232,64,168,0.1)] text-[var(--color-accent-primary)]">
          <Icon size={22} />
        </div>
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-[var(--color-text-muted)]">
            Достижение разблокировано!
          </div>
          <div className="mt-0.5 truncate bg-gradient-to-r from-[#e840a8] to-[#a855f7] bg-clip-text text-[14px] font-semibold text-transparent">
            {achievement.label}
          </div>
        </div>
      </div>
    </div>
  );
}
