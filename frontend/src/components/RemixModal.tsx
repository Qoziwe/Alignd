import {useCallback, useEffect, useMemo, useState} from 'react';
import {createPortal} from 'react-dom';
import {
  BookOpen,
  Camera,
  Check,
  Copy,
  EyeOff,
  GraduationCap,
  Lightbulb,
  ScrollText,
  Smile,
  X,
} from 'lucide-react';
import ooppssieMaskot from '../../assets/ooppssieMaskot.png';
import {API_BASE_URL, fetchJson} from '../lib/api';

type RemixFormat = 'expert_blog' | 'humor' | 'faceless' | 'storytelling' | 'educational';
type ModalMode = 'format' | 'loading' | 'result' | 'error';

type RemixResult = {
  hook: string;
  scenario: string[];
  shotList: string[];
  captions: string[];
  hashtags: string[];
  thumbnailText: string;
  shootingTips: string[];
  format: string;
};

type RemixResponse = {
  id: string;
  trendId: string;
  format: string;
  result: RemixResult;
  createdAt: string;
  analysisModel: string;
};

type RemixModalProps = {
  trendId: string;
  trendTitle: string;
  onClose: () => void;
};

const formatOptions: Array<{value: RemixFormat; label: string; icon: typeof GraduationCap; className: string}> = [
  {value: 'expert_blog', label: 'Эксперт', icon: GraduationCap, className: 'sm:col-span-3'},
  {value: 'humor', label: 'Юмор', icon: Smile, className: 'sm:col-span-3'},
  {value: 'faceless', label: 'Faceless', icon: EyeOff, className: 'sm:col-span-2'},
  {value: 'storytelling', label: 'История', icon: ScrollText, className: 'sm:col-span-2'},
  {value: 'educational', label: 'Обучение', icon: BookOpen, className: 'sm:col-span-2'},
];

function UpseeThinking() {
  return (
    <div className="flex h-[90px] w-[90px] items-center justify-center" aria-label="Upsee thinking">
      <img src={ooppssieMaskot} alt="" className="h-full w-full object-contain opacity-90" />
    </div>
  );
}

function formatPlan(result: RemixResult) {
  return [
    `Формат: ${result.format}`,
    '',
    `Хук: ${result.hook}`,
    '',
    'Сценарий:',
    ...result.scenario.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Shot list:',
    ...result.shotList.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Captions:',
    ...result.captions.map((item, index) => `${index + 1}. ${item}`),
    '',
    `Thumbnail: ${result.thumbnailText}`,
    '',
    'Hashtags:',
    result.hashtags.map((tag) => `#${tag}`).join(' '),
    '',
    'Советы:',
    ...result.shootingTips.map((item, index) => `${index + 1}. ${item}`),
  ].join('\n');
}

export default function RemixModal({trendId, trendTitle, onClose}: RemixModalProps) {
  const [mode, setMode] = useState<ModalMode>('format');
  const [selectedFormat, setSelectedFormat] = useState<RemixFormat>('expert_blog');
  const [result, setResult] = useState<RemixResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [copiedKey, setCopiedKey] = useState('');

  const copyText = useCallback((key: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((value) => (value === key ? '' : value)), 2000);
  }, []);

  const generateRemix = useCallback(
    async (format: RemixFormat) => {
      setMode('loading');
      setSelectedFormat(format);
      setErrorMessage('');

      try {
        const payload = await fetchJson<RemixResponse>(`${API_BASE_URL}/trends/${trendId}/remix`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({format}),
        });
        setResult(payload.result);
        setMode('result');
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Не удалось создать Remix.');
        setMode('error');
      }
    },
    [trendId],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const formattedPlan = useMemo(() => (result ? formatPlan(result) : ''), [result]);

  if (typeof document === 'undefined') {
    return null;
  }

  const modalContent = (
    <div
      className="fixed inset-0 z-[500] flex items-start justify-center overflow-y-auto bg-[rgba(5,5,7,0.85)] px-4 py-6 backdrop-blur-[8px] [scrollbar-width:none] sm:items-center sm:py-8 [&::-webkit-scrollbar]:hidden"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative max-h-[calc(100vh-48px)] w-full max-w-[560px] overflow-hidden rounded-[24px] border border-[var(--color-border-default)] bg-[var(--color-background-elevated)] p-5 shadow-[0_30px_100px_rgba(0,0,0,0.45)] sm:p-7"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-border-default)] text-[var(--color-text-muted)] transition-colors hover:border-[#a855f7] hover:text-[var(--color-text-heading)]"
          aria-label="Закрыть"
        >
          <X size={18} />
        </button>

        {mode === 'format' && (
          <div>
            <h2 className="pr-10 text-[26px] font-extrabold leading-tight text-[var(--color-text-heading)]">
              Выбери формат
            </h2>
            <p className="mt-2 pr-10 text-[14px] leading-[1.45] text-[var(--color-text-muted)]">{trendTitle}</p>

            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-6">
              {formatOptions.map(({value, label, icon: Icon, className}) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => void generateRemix(value)}
                  className={`flex min-h-[92px] min-w-0 flex-col items-start justify-between rounded-[16px] border border-[var(--color-border-default)] p-4 text-left transition-colors hover:border-[#a855f7] ${className}`}
                >
                  <Icon size={22} className="text-[var(--color-accent-primary)]" />
                  <span className="mt-3 break-words text-[15px] font-bold leading-tight text-[var(--color-text-heading)]">{label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === 'loading' && (
          <div className="flex min-h-[300px] flex-col items-center justify-center text-center">
            <UpseeThinking />
            <p className="mt-5 text-[15px] text-[var(--color-text-muted)]">Upsee адаптирует тренд под тебя...</p>
            <div className="simple-loader-line mt-5 w-full max-w-[240px]">
              <span></span>
            </div>
          </div>
        )}

        {mode === 'error' && (
          <div className="flex min-h-[260px] flex-col items-center justify-center text-center">
            <h2 className="text-[24px] font-extrabold text-[var(--color-text-heading)]">Не получилось создать Remix</h2>
            <p className="mt-3 max-w-[360px] text-[14px] leading-[1.45] text-[var(--color-text-muted)]">
              {errorMessage}
            </p>
            <button
              type="button"
              onClick={() => void generateRemix(selectedFormat)}
              className="mt-6 rounded-[12px] border border-[var(--color-accent-primary)] px-5 py-2 text-[14px] font-bold text-[var(--color-accent-primary)] transition-colors hover:bg-[rgba(232,64,168,0.1)]"
            >
              Попробовать снова
            </button>
          </div>
        )}

        {mode === 'result' && result && (
          <div className="max-h-[calc(100vh-104px)] overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <h2 className="pr-10 text-[24px] font-extrabold text-[var(--color-text-heading)]">Remix готов</h2>
            <p className="mt-1 pr-10 text-[13px] text-[var(--color-text-muted)]">{result.format}</p>

            <section className="mt-6 rounded-r-[12px] border-l-[3px] border-l-[#e840a8] bg-[rgba(232,64,168,0.06)] p-4">
              <div className="bg-gradient-to-r from-[#e840a8] to-[#a855f7] bg-clip-text text-[20px] font-bold leading-[1.35] text-transparent">
                {result.hook}
              </div>
            </section>

            <section className="mt-6">
              <h3 className="text-[15px] font-bold text-[var(--color-text-heading)]">Сценарий</h3>
              <div className="mt-3 space-y-3">
                {result.scenario.map((item, index) => (
                  <div key={`${item}-${index}`} className="flex gap-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-[#e840a8] to-[#a855f7] text-[12px] font-black text-white">
                      {index + 1}
                    </div>
                    <p className="text-[14px] leading-[1.45] text-[var(--color-text-body)]">{item}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-6">
              <h3 className="text-[15px] font-bold text-[var(--color-text-heading)]">Shot List</h3>
              <div className="mt-3 space-y-2">
                {result.shotList.map((item, index) => (
                  <div key={`${item}-${index}`} className="flex gap-3 rounded-[12px] border border-[var(--color-border-default)] bg-black/20 p-3">
                    <Camera size={17} className="mt-0.5 shrink-0 text-[var(--color-accent-secondary)]" />
                    <p className="text-[13px] leading-[1.45] text-[var(--color-text-body)]">{item}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-6">
              <h3 className="text-[15px] font-bold text-[var(--color-text-heading)]">Captions</h3>
              <div className="mt-3 space-y-2">
                {result.captions.map((caption, index) => {
                  const key = `caption-${index}`;
                  const copied = copiedKey === key;
                  return (
                    <div key={key} className="flex gap-3 rounded-[12px] border border-[var(--color-border-default)] bg-black/20 p-3">
                      <p className="min-w-0 flex-1 text-[13px] leading-[1.45] text-[var(--color-text-body)]">{caption}</p>
                      <button
                        type="button"
                        onClick={() => copyText(key, caption)}
                        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[9px] border border-[var(--color-border-default)] px-2 text-[12px] text-[var(--color-text-muted)] transition-colors hover:border-[#a855f7] hover:text-[var(--color-text-heading)]"
                      >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                        {copied ? 'Готово' : 'Копировать'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="mt-6">
              <h3 className="text-[15px] font-bold text-[var(--color-text-heading)]">Hashtags</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {result.hashtags.map((tag) => (
                  <button
                    type="button"
                    key={tag}
                    onClick={() => copyText(`tag-${tag}`, `#${tag}`)}
                    className="rounded-full border border-[var(--color-border-default)] bg-[rgba(168,85,247,0.08)] px-3 py-1 text-[12px] text-[var(--color-text-muted)] transition-colors hover:border-[#a855f7] hover:text-[var(--color-text-heading)]"
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            </section>

            <section className="mt-6 rounded-[16px] border border-[var(--color-border-default)] p-5 text-center">
              <div className="text-[11px] font-bold uppercase text-[var(--color-text-muted)]">Thumbnail Text</div>
              <div className="mt-2 text-[24px] font-black text-[var(--color-text-heading)]">{result.thumbnailText}</div>
            </section>

            <section className="mt-6">
              <h3 className="text-[15px] font-bold text-[var(--color-text-heading)]">Tips</h3>
              <div className="mt-3 space-y-2">
                {result.shootingTips.map((item, index) => (
                  <div key={`${item}-${index}`} className="flex gap-3 text-[13px] leading-[1.45] text-[var(--color-text-body)]">
                    <Lightbulb size={16} className="mt-0.5 shrink-0 text-[var(--color-accent-primary)]" />
                    {item}
                  </div>
                ))}
              </div>
            </section>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => copyText('all', formattedPlan)}
                className="inline-flex h-11 flex-1 items-center justify-center rounded-[12px] bg-gradient-to-r from-[#e840a8] to-[#a855f7] px-5 text-[14px] font-bold text-white"
              >
                {copiedKey === 'all' ? 'Скопировано' : 'Скопировать всё'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-11 items-center justify-center rounded-[12px] border border-[var(--color-border-default)] px-5 text-[14px] font-bold text-[var(--color-text-muted)] transition-colors hover:border-[#a855f7] hover:text-[var(--color-text-heading)]"
              >
                Закрыть
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
