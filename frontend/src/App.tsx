import React, {useEffect, useRef, useState} from 'react';
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  Flame,
  Heart,
  Lightbulb,
  LogOut,
  Mail,
  Shield,
  Sparkles,
  Trash2,
  TrendingUp,
  UserRound,
  Zap,
} from 'lucide-react';
import heroLiquid from '../assets/image.png';
import {COOKIE_SESSION_MARKER} from './lib/auth';
import {
  extractUsername,
  formatAnalysisDate,
  formatCompactNumber,
  getInitials,
} from './lib/formatting';
import aligndLogo from '../assets/AligndLogo.png';

type Screen = 'home' | 'loading' | 'results' | 'profile';
type AuthMode = 'login' | 'register';
type PreloaderMode = 'analysis' | 'saved' | null;

type User = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
};

type Trend = {
  type: 'top' | 'growing';
  title: string;
  description: string;
  match: number;
};

type Idea = {
  tag: string;
  title: string;
  hook: string;
  angle: string;
};

type AnalysisResponse = {
  id: string;
  account: {
    username: string;
    fullName: string;
    biography: string;
    followersCount: number | null;
    followsCount: number | null;
    postsCount: number | null;
    profilePicUrl: string;
    platform: string;
    profileUrl: string;
    niche: string;
    recentPosts: Array<{
      caption: string;
      likesCount: number | null;
      commentsCount: number | null;
      videoViewCount: number | null;
      timestamp: string;
    }>;
  };
  analysis: {
    profileSummary: {
      niche: string;
      compatibilityLabel: string;
      compatibilityScore: number;
      positioning: string;
      audienceSummary: string;
    };
    trends: Trend[];
    ideas: Idea[];
    hooks: string[];
    recommendations: {
      summary: string;
      bullets: string[];
    };
  };
  sources: Array<{
    title: string;
    url: string;
  }>;
  createdAt: string;
  analysisModel?: string;
  niche?: string;
  cached: boolean;
};

type AnalysisHistoryItem = {
  id: string;
  profileUrl: string;
  username: string;
  niche: string;
  compatibilityScore: number | null;
  createdAt: string;
};

const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:5000').replace(/\/$/, '');
const shellContainerClass = 'mx-auto w-full max-w-[1184px] px-4 sm:px-6 lg:px-8';
const pageClass = 'w-full pb-10 sm:pb-12';
const cardClass =
  'rounded-[18px] border border-white/10 bg-[#15151A] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.18)] sm:p-7 lg:p-8';
const solidCardClass =
  'rounded-[18px] border border-white/10 bg-[#15151A] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.18)] sm:p-7 lg:p-8';
const sectionTitleClass =
  'flex items-center gap-3 text-[22px] font-black uppercase leading-[1.15] tracking-[0] text-white sm:text-[26px]';
const iconTitleClass = 'shrink-0 text-white';
const inputClass =
  'h-[54px] rounded-xl border border-white/12 bg-[rgba(255,255,255,0.06)] px-4 text-[16px] text-gray-200 placeholder:text-gray-500 focus:border-white/28 focus:outline-none sm:h-[58px] sm:px-5';
const primaryButtonClass =
  'inline-flex h-[54px] items-center justify-center rounded-xl bg-[#ECECEC] px-6 text-[16px] font-bold text-black transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-70 sm:h-[58px] sm:px-8';
const secondaryButtonClass =
  'inline-flex h-[48px] items-center justify-center gap-3 rounded-xl border border-white/14 bg-white/6 px-5 text-[15px] font-semibold text-gray-100 transition-colors hover:bg-white/10';

class ApiRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

function extractErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }

  const error =
    typeof (payload as {error?: unknown}).error === 'string'
      ? (payload as {error: string}).error
      : fallback;

  return error;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      credentials: 'include',
    });
  } catch (error) {
    throw new ApiRequestError(error instanceof Error ? error.message : 'Network request failed.', 0);
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiRequestError(extractErrorMessage(payload, 'Request failed.'), response.status);
  }

  return payload as T;
}

function LoadingAtom() {
  return (
    <div className="loading-atom" aria-hidden="true">
      <div className="loading-atom-rings">
        <div className="loading-atom-ring loading-atom-ring-one"></div>
        <div className="loading-atom-ring loading-atom-ring-two"></div>
        <div className="loading-atom-ring loading-atom-ring-three"></div>
      </div>
      <div className="loading-atom-core">
        <div className="absolute inset-4 rounded-full border border-white/10"></div>
        <Sparkles size={34} className="loading-spark text-white" strokeWidth={2.2} />
      </div>
    </div>
  );
}

function AnalysisPreloader() {
  return (
    <div className="flex w-full max-w-[920px] flex-col items-center text-center">
      <LoadingAtom />

      <div className="mt-2 inline-flex min-h-[42px] items-center gap-3 rounded-full border border-white/12 bg-white/6 px-5 text-[14px] font-semibold text-gray-200">
        <span className="h-2 w-2 rounded-full bg-white/55"></span>
        Анализ профиля запущен
      </div>

      <h2 className="mt-6 text-[26px] font-black leading-[1.08] tracking-[0] text-white sm:mt-7 sm:text-[42px] sm:leading-[1.05]">
        Собираем персональный разбор
      </h2>
      <p className="mt-5 max-w-[620px] text-[16px] leading-[1.55] text-gray-400 sm:text-[18px]">
        Проверяем профиль, считываем контент-сигналы и подбираем идеи, которые подходят именно под вашу нишу.
      </p>

      <div className="mt-10 w-full max-w-[640px] overflow-hidden rounded-full border border-white/10 bg-white/8 p-1">
        <div className="loading-progress h-[8px] rounded-full"></div>
      </div>

      <div className="mt-8 grid w-full max-w-[780px] grid-cols-1 gap-3 text-left sm:grid-cols-3">
        {[
          ['01', 'Профиль', 'Данные и описание'],
          ['02', 'Контент', 'Посты и реакции'],
          ['03', 'Идеи', 'Тренды и хуки'],
        ].map(([step, title, description]) => (
          <div key={step} className="rounded-[16px] border border-white/10 bg-[#15151A] px-5 py-4">
            <div className="text-[12px] font-black text-gray-300">{step}</div>
            <div className="mt-2 text-[16px] font-bold text-white">{title}</div>
            <div className="mt-1 text-[13px] text-gray-500">{description}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SavedAnalysisPreloader() {
  return (
    <div className="flex w-full max-w-[420px] flex-col items-center rounded-[18px] border border-white/10 bg-[#111116] px-8 py-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
      <div className="text-[24px] font-black tracking-[0] text-white">ALIGND</div>
      <div className="simple-loader-line mt-5">
        <span></span>
      </div>
      <div className="mt-5 text-[16px] font-bold text-white">Открываем отчёт</div>
      <div className="mt-2 text-[14px] text-gray-500">Загружаем сохранённый анализ</div>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [authMode, setAuthMode] = useState<AuthMode>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [authError, setAuthError] = useState('');
  const [analysisError, setAnalysisError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [profileMessage, setProfileMessage] = useState('');
  const [authLoading, setAuthLoading] = useState(true);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [clearAnalysesLoading, setClearAnalysesLoading] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState('');
  const [history, setHistory] = useState<AnalysisHistoryItem[]>([]);
  const [report, setReport] = useState<AnalysisResponse | null>(null);
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const [url, setUrl] = useState('');
  const [niche, setNiche] = useState('');
  const [isAdviceExpanded, setIsAdviceExpanded] = useState(false);
  const [preloaderMode, setPreloaderMode] = useState<PreloaderMode>(null);
  const formSectionRef = useRef<HTMLDivElement | null>(null);

  const isResults = screen === 'results';
  const primaryIdea = report?.analysis.ideas[0];
  const secondaryIdeas = report?.analysis.ideas.slice(1) || [];
  const displayUsername = report?.account.username || extractUsername(url);
  const displayNiche =
    report?.niche ||
    report?.analysis.profileSummary.niche ||
    report?.account.niche ||
    niche ||
    'Личный бренд / экспертный контент';
  const averageCompatibility =
    history.length > 0
      ? Math.round(
          history.reduce((total, item) => total + (item.compatibilityScore ?? 0), 0) /
            history.filter((item) => item.compatibilityScore !== null).length || 0,
        )
      : 0;
  const latestAnalysisDate = history[0]?.createdAt ? formatAnalysisDate(history[0].createdAt) : 'Пока нет';

  const loadHistory = async () => {
    setHistoryLoading(true);
    setHistoryError('');

    try {
      const payload = await fetchJson<{items: AnalysisHistoryItem[]}>(`${API_BASE_URL}/analyses`);
      setHistory(payload.items);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Не удалось загрузить историю.');
    } finally {
      setHistoryLoading(false);
    }
  };

  const openSavedAnalysis = async (analysisId: string) => {
    if (!token) {
      return;
    }

    setAnalysisError('');
    setPreloaderMode('saved');

    try {
      const payload = await fetchJson<AnalysisResponse>(`${API_BASE_URL}/analyses/${analysisId}`);
      setReport(payload);
      setUrl(payload.account.profileUrl || '');
      setNiche(payload.niche || payload.analysis.profileSummary.niche || payload.account.niche || '');
      setScreen('results');
      setPreloaderMode(null);
    } catch (error) {
      setScreen('home');
      setPreloaderMode(null);
      setAnalysisError(
        error instanceof Error ? error.message : 'Не удалось открыть сохранённый анализ.',
      );
    }
  };

  useEffect(() => {
    fetchJson<{user: User}>(`${API_BASE_URL}/auth/me`)
      .then((payload) => {
        setToken(COOKIE_SESSION_MARKER);
        setUser(payload.user);
        return loadHistory();
      })
      .catch((error) => {
        if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
          setToken('');
          setUser(null);
          return;
        }

        setAuthError('Не удалось проверить сессию. Обновите страницу или попробуйте позже.');
      })
      .finally(() => {
        setAuthLoading(false);
      });
  }, []);

  useEffect(() => {
    setAvatarLoadFailed(false);
  }, [report?.id, report?.account.profilePicUrl]);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      window.scrollTo({top: 0, left: 0, behavior: 'auto'});
    });
  }, [screen]);

  const scrollToForm = () => {
    formSectionRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  const handleAuthSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError('');
    setAuthSubmitting(true);

    try {
      const endpoint = authMode === 'register' ? '/auth/register' : '/auth/login';
      const payload = await fetchJson<{token: string; user: User}>(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
          displayName,
        }),
      });

      setToken(COOKIE_SESSION_MARKER);
      setUser(payload.user);
      setPassword('');
      setAuthMode('login');
      await loadHistory();
      scrollToForm();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Не удалось выполнить вход.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = async () => {
    if (!token) {
      return;
    }

    try {
      await fetchJson<{status: string}>(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
      });
    } catch {
      // Ignore server-side logout failures and clear the client session anyway.
    }

    setToken('');
    setUser(null);
    setHistory([]);
    setReport(null);
    setScreen('home');
    setAnalysisError('');
  };

  const handleOpenProfile = () => {
    if (!user) {
      return;
    }

    setProfileMessage('');
    setAnalysisError('');
    setIsAdviceExpanded(false);
    setScreen('profile');
  };

  const handleClearAnalyses = async () => {
    if (!token || clearAnalysesLoading || history.length === 0) {
      return;
    }

    const confirmed = window.confirm('Очистить все сохранённые анализы? Это действие нельзя отменить.');
    if (!confirmed) {
      return;
    }

    setClearAnalysesLoading(true);
    setHistoryError('');
    setProfileMessage('');

    try {
      const payload = await fetchJson<{status: string; deletedCount: number}>(`${API_BASE_URL}/analyses/clear`, {
        method: 'POST',
      });
      setHistory([]);
      setReport(null);
      setProfileMessage(`Удалено анализов: ${payload.deletedCount}.`);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Не удалось очистить анализы.');
    } finally {
      setClearAnalysesLoading(false);
    }
  };

  const handleAnalyze = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!token) {
      setAnalysisError('Сначала войдите в аккаунт.');
      return;
    }
    if (!url.trim()) {
      return;
    }

    setAnalysisError('');
    setIsAdviceExpanded(false);
    setPreloaderMode('analysis');
    setScreen('loading');

    try {
      const payload = await fetchJson<AnalysisResponse>(`${API_BASE_URL}/analyze-account`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          profileUrl: url.trim(),
          niche: niche.trim(),
        }),
      });

      setReport(payload);
      setScreen('results');
      setPreloaderMode(null);
      await loadHistory();
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : 'Не удалось выполнить анализ.');
      setScreen('home');
      setPreloaderMode(null);
    }
  };

  const handleBack = () => {
    setScreen('home');
    setIsAdviceExpanded(false);
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden bg-[#050507] font-sans text-white selection:bg-white/20">
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        {isResults ? (
          <>
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(57,48,85,0.22),transparent_26%),radial-gradient(circle_at_18%_24%,rgba(77,101,138,0.12),transparent_24%),radial-gradient(circle_at_78%_42%,rgba(72,84,108,0.12),transparent_20%),linear-gradient(180deg,#06060A_0%,#050507_52%,#040406_100%)]" />
            <div className="absolute left-[-10%] top-[10%] h-[340px] w-[340px] rounded-full bg-[rgba(112,128,186,0.07)] blur-[120px]" />
            <div className="absolute right-[-8%] top-[30%] h-[280px] w-[280px] rounded-full bg-[rgba(121,112,162,0.07)] blur-[120px]" />
          </>
        ) : (
          <>
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(66,71,111,0.32),transparent_34%),radial-gradient(circle_at_14%_18%,rgba(100,115,174,0.16),transparent_20%),radial-gradient(circle_at_84%_14%,rgba(122,96,164,0.16),transparent_20%),linear-gradient(180deg,#11131d_0%,#08090f_28%,#050507_62%,#040406_100%)]" />
            <div className="absolute left-[-8%] top-[7%] h-[380px] w-[380px] rounded-full bg-[rgba(124,142,255,0.08)] blur-[120px]" />
            <div className="absolute right-[-10%] top-[-2%] h-[340px] w-[340px] rounded-full bg-[rgba(170,154,255,0.08)] blur-[140px]" />
          </>
        )}
      </div>

      {preloaderMode && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#050507]/94 px-4 py-8 backdrop-blur-md sm:items-center sm:px-6">
          {preloaderMode === 'analysis' ? <AnalysisPreloader /> : <SavedAnalysisPreloader />}
          <div className="hidden w-full max-w-[920px] flex-col items-center text-center">
            <div className="relative flex h-[210px] w-[210px] items-center justify-center sm:h-[250px] sm:w-[250px]">
              <div className="loading-orbit loading-orbit-outer"></div>
              <div className="loading-orbit loading-orbit-inner"></div>
              <div className="loading-sweep"></div>
              <div className="relative z-10 flex h-[116px] w-[116px] items-center justify-center rounded-full border border-white/18 bg-[#141419] shadow-[0_24px_80px_rgba(0,0,0,0.42)]">
                <div className="absolute inset-4 rounded-full border border-white/10"></div>
                <Sparkles size={34} className="loading-spark text-white" strokeWidth={2.2} />
              </div>
            </div>

            <div className="mt-2 inline-flex min-h-[42px] items-center gap-3 rounded-full border border-white/12 bg-white/6 px-5 text-[14px] font-semibold text-gray-200">
              <span className="h-2 w-2 rounded-full bg-white/55"></span>
              Анализ профиля запущен
            </div>

            <h2 className="mt-6 text-[26px] font-black leading-[1.08] tracking-[0] text-white sm:mt-7 sm:text-[42px] sm:leading-[1.05]">
              Собираем персональный разбор
            </h2>
            <p className="mt-5 max-w-[620px] text-[16px] leading-[1.55] text-gray-400 sm:text-[18px]">
              Проверяем профиль, считываем контент-сигналы и подбираем идеи, которые подходят именно под вашу нишу.
            </p>

            <div className="mt-10 w-full max-w-[640px] overflow-hidden rounded-full border border-white/10 bg-white/8 p-1">
              <div className="loading-progress h-[8px] rounded-full bg-white/10"></div>
            </div>
          </div>
        </div>
      )}

      <header className={`${shellContainerClass} relative z-10 flex flex-wrap items-center justify-between gap-3 pb-4 pt-6 sm:pt-8 lg:pt-10`}>
        <button
          type="button"
          onClick={() => setScreen('home')}
          className="inline-flex min-w-0 items-center gap-2 sm:gap-3"
          aria-label="Alignd home"
        >
          <img src={aligndLogo} alt="Alignd" className="h-[34px] w-auto object-contain sm:h-[42px]" />
          <span className="text-[23px] font-black tracking-[0] text-white sm:text-[28px]">Alignd</span>
        </button>
        {authLoading ? (
          <div className="text-sm text-gray-400">Проверяем сессию...</div>
        ) : user ? (
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={handleOpenProfile}
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/6 px-3 py-2 text-sm text-gray-200 transition-colors hover:bg-white/10 sm:px-4"
            >
              <UserRound size={16} />
              <span className="hidden sm:inline">{user.displayName}</span>
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="hidden"
            >
              <LogOut size={16} />
              Выйти
            </button>
          </div>
        ) : (
          <div className="rounded-full border border-white/12 bg-white/6 px-4 py-2 text-sm text-gray-200">
            Нужен аккаунт
          </div>
        )}
      </header>

      <main className={`${shellContainerClass} relative z-10 flex-1 pb-0`}>
        {screen === 'home' && (
          <div className={pageClass}>
            <section className="relative mt-2 grid gap-8 sm:mt-6 lg:grid-cols-[minmax(0,700px)_minmax(300px,1fr)] lg:items-center lg:gap-12">
              <div className="max-w-[760px]">
                <div className="mb-6 inline-flex max-w-full items-center gap-2 rounded-2xl border border-white/18 bg-white/[0.03] px-4 py-2 text-[13px] font-medium leading-[1.35] text-gray-300 shadow-[0_12px_40px_rgba(0,0,0,0.25)] backdrop-blur-md sm:mb-8 sm:rounded-full sm:px-6 sm:py-2.5 sm:text-[15px]">
                  <Sparkles size={16} className="shrink-0" />
                  Анализ профиля, тренды и идеи под ваш контент
                </div>

                <h1 className="max-w-[760px] text-[42px] font-bold leading-[1.03] tracking-[0] text-white sm:text-[56px] sm:leading-[1] lg:text-[64px] lg:leading-[0.98] xl:text-[68px]">
                  <span className="block lg:whitespace-nowrap">Создавай контент,</span>
                  <span className="block">который попадает в тренд</span>
                </h1>

                <p className="mt-5 max-w-[720px] text-[17px] leading-[1.45] text-gray-300 sm:mt-6 sm:text-[19px] lg:text-[20px]">
                  Получайте персональный анализ Instagram или TikTok профиля, идеи для роликов,
                  цепляющие хуки и рекомендации для роста.
                </p>

                <button
                  type="button"
                  onClick={scrollToForm}
                  className={`${primaryButtonClass} mt-7 w-full shadow-[0_18px_60px_rgba(255,255,255,0.08)] sm:mt-9 sm:w-auto sm:text-[17px]`}
                >
                  Начать анализ
                </button>
              </div>

              <div className="relative flex justify-center lg:justify-end">
                <img
                  src={heroLiquid}
                  alt="Abstract glossy liquid shape"
                  className="w-full max-w-[320px] object-contain drop-shadow-[0_30px_90px_rgba(0,0,0,0.65)] sm:max-w-[400px] lg:max-w-[440px]"
                />
              </div>
            </section>

            {!user && !authLoading && (
              <section className={`${cardClass} mt-10 backdrop-blur-md sm:mt-12`}>
                <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                  <div>
                    <h2 className="text-[24px] font-black tracking-[0] text-white sm:text-[28px]">Аккаунт</h2>
                    <p className="mt-2 max-w-[520px] text-[15px] text-gray-400">
                      Зарегистрируйтесь или войдите, чтобы запускать анализ и сохранять историю отчётов.
                    </p>
                  </div>

                  <div className="inline-flex w-full rounded-full border border-white/10 bg-black/30 p-1 sm:w-auto">
                    <button
                      type="button"
                      onClick={() => setAuthMode('register')}
                      className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition-colors sm:flex-none ${
                        authMode === 'register' ? 'bg-white text-black' : 'text-gray-300'
                      }`}
                    >
                      Регистрация
                    </button>
                    <button
                      type="button"
                      onClick={() => setAuthMode('login')}
                      className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition-colors sm:flex-none ${
                        authMode === 'login' ? 'bg-white text-black' : 'text-gray-300'
                      }`}
                    >
                      Вход
                    </button>
                  </div>
                </div>

                <form onSubmit={handleAuthSubmit} className="mt-6 grid gap-3 sm:gap-4 md:grid-cols-2">
                  {authMode === 'register' && (
                    <input
                      type="text"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      placeholder="Ваше имя"
                      className={inputClass}
                      required
                    />
                  )}
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="Email"
                    className={inputClass}
                    required
                  />
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Пароль"
                    className={inputClass}
                    required
                  />
                  <button
                    type="submit"
                    disabled={authSubmitting}
                    className={`${primaryButtonClass} sm:text-[17px]`}
                  >
                    {authSubmitting ? 'Подождите...' : authMode === 'register' ? 'Создать аккаунт' : 'Войти'}
                  </button>
                </form>

                {authError && (
                  <div className="mt-4 rounded-2xl border border-[#5B2730] bg-[rgba(91,39,48,0.22)] px-5 py-4 text-[15px] text-[#FFD1D8]">
                    {authError}
                  </div>
                )}
              </section>
            )}

            <section
              ref={formSectionRef}
              className={`${cardClass} ${user ? 'mt-16 sm:mt-20 lg:mt-24' : 'mt-6'} backdrop-blur-md`}
            >
              <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
                <div>
                  <h2 className="text-[24px] font-black tracking-[0] text-white sm:text-[28px]">Новый анализ</h2>
                  <p className="mt-2 text-[15px] text-gray-400">
                    Вставьте ссылку на профиль и опишите нишу, чтобы получить точный разбор.
                  </p>
                </div>
                {user && (
                  <button
                    type="button"
                    onClick={handleOpenProfile}
                    className="max-w-full break-all rounded-2xl border border-white/12 bg-white/6 px-4 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-white/10 focus:border-white/28 focus:outline-none sm:rounded-full"
                  >
                    {user.email}
                  </button>
                )}
              </div>

              <form onSubmit={handleAnalyze} className="mt-6 space-y-6">
                <div>
                  <label className="mb-3 block text-[16px] font-bold text-white sm:mb-4 sm:text-[18px]">Ссылка на профиль</label>
                  <div className="flex flex-col gap-4 md:flex-row md:items-center">
                    <input
                      type="text"
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder="Instagram или TikTok URL"
                      className={`${inputClass} w-full min-w-0 md:flex-1`}
                      required
                    />
                    <button
                      type="submit"
                      disabled={!user}
                      className={`${primaryButtonClass} w-full disabled:opacity-60 md:w-auto md:min-w-[220px]`}
                    >
                      Анализировать
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-3 block text-[16px] font-bold text-white sm:mb-4 sm:text-[18px]">Ниша</label>
                  <input
                    type="text"
                    value={niche}
                    onChange={(event) => setNiche(event.target.value)}
                    placeholder="Например: маркетинг для малого бизнеса"
                    className={`${inputClass} w-full`}
                  />
                </div>

                {analysisError && (
                  <div className="rounded-2xl border border-[#5B2730] bg-[rgba(91,39,48,0.22)] px-5 py-4 text-[15px] text-[#FFD1D8]">
                    {analysisError}
                  </div>
                )}

                {!user && !authLoading && (
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-[15px] text-gray-300">
                    Чтобы запустить анализ, сначала войдите или зарегистрируйтесь.
                  </div>
                )}
              </form>
            </section>

            {user && (
              <section className={`${cardClass} mt-6`}>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <h2 className="text-[22px] font-black tracking-[0] text-white sm:text-[24px]">Последние анализы</h2>
                  {historyLoading && <div className="text-sm text-gray-400">Обновляем историю...</div>}
                </div>

                {historyError && (
                  <div className="mt-4 rounded-2xl border border-[#5B2730] bg-[rgba(91,39,48,0.22)] px-5 py-4 text-[15px] text-[#FFD1D8]">
                    {historyError}
                  </div>
                )}

                {!historyLoading && history.length === 0 && !historyError && (
                  <p className="mt-4 text-[15px] text-gray-400">
                    Здесь появятся ваши последние отчёты после первого анализа.
                  </p>
                )}

                {history.length > 0 && (
                  <div className="mt-5 grid gap-3 md:grid-cols-2">
                    {history.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() => void openSavedAnalysis(item.id)}
                        className="rounded-[18px] border border-white/10 bg-black/20 px-4 py-4 text-left transition-colors hover:border-white/18 hover:bg-black/30 sm:px-5 sm:py-5"
                      >
                        <div className="break-all text-[17px] font-bold text-white sm:text-[18px]">@{item.username.toUpperCase()}</div>
                        <div className="mt-2 text-[14px] text-gray-400">{item.niche || 'Без ниши'}</div>
                        <div className="mt-4 flex items-center justify-between text-[14px] text-gray-300">
                          <span>{formatAnalysisDate(item.createdAt)}</span>
                          <span>{item.compatibilityScore ?? '—'}%</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        )}

        {screen === 'profile' && user && (
          <div className={`${pageClass} mt-2 sm:mt-6`}>
            <button
              type="button"
              onClick={() => setScreen('home')}
              className="inline-flex items-center justify-center gap-3 rounded-2xl border border-white/18 bg-white/[0.03] px-5 py-2 text-[15px] font-semibold text-gray-100 shadow-[0_12px_40px_rgba(0,0,0,0.25)] backdrop-blur-md transition-colors hover:bg-white/10 sm:rounded-full sm:py-2.5"
            >
              <ArrowLeft size={18} />
              Назад
            </button>

            <section className={`${solidCardClass} mt-4 sm:mt-6`}>
              <div className="flex flex-col gap-4 sm:gap-6 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
                  <div className="flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-full bg-[#E7E7E7] text-[24px] font-black text-black sm:h-[112px] sm:w-[112px] sm:text-[34px]">
                    {getInitials(user.displayName)}
                  </div>
                  <div>
                    <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/12 bg-white/6 px-3 py-2 text-[13px] font-semibold text-gray-300 sm:px-4">
                      <Shield size={15} className="shrink-0" />
                      Аккаунт активен
                    </div>
                    <h1 className="mt-3 break-words text-[27px] font-black tracking-[0] text-white sm:mt-5 sm:text-[34px] md:text-[44px]">
                      {user.displayName}
                    </h1>
                    <div className="mt-3 flex min-w-0 flex-wrap gap-2 text-[15px] text-gray-300 sm:mt-4 sm:gap-3">
                      <span className="inline-flex max-w-full items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 sm:rounded-full sm:px-4">
                        <Mail size={15} className="shrink-0" />
                        <span className="min-w-0 break-all">{user.email}</span>
                      </span>
                      <span className="inline-flex max-w-full items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 sm:rounded-full sm:px-4">
                        <CalendarDays size={15} className="shrink-0" />
                        <span className="min-w-0 break-words">С нами с {formatAnalysisDate(user.createdAt)}</span>
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex h-[46px] w-full items-center justify-center gap-2 rounded-xl border border-white/14 bg-white/6 px-5 text-[15px] font-semibold text-gray-100 transition-colors hover:bg-white/10 sm:h-[50px] sm:w-fit sm:px-6"
                >
                  <LogOut size={17} />
                  Выйти
                </button>
              </div>
            </section>

            <section className="mt-6 grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-3">
              <article className="rounded-[16px] border border-white/10 bg-[#15151A] p-5 sm:p-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="text-[14px] font-semibold text-gray-400">Всего анализов</div>
                  <BarChart3 size={20} className="text-gray-300" />
                </div>
                <div className="mt-4 text-[32px] font-black tracking-[0] text-white sm:mt-5 sm:text-[36px]">{history.length}</div>
              </article>

              <article className="rounded-[16px] border border-white/10 bg-[#15151A] p-5 sm:p-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="text-[14px] font-semibold text-gray-400">Средняя совместимость</div>
                  <TrendingUp size={20} className="text-gray-300" />
                </div>
                <div className="mt-4 text-[32px] font-black tracking-[0] text-white sm:mt-5 sm:text-[36px]">
                  {averageCompatibility ? `${averageCompatibility}%` : '—'}
                </div>
              </article>

              <article className="rounded-[16px] border border-white/10 bg-[#15151A] p-5 sm:p-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="text-[14px] font-semibold text-gray-400">Последний отчет</div>
                  <CalendarDays size={20} className="text-gray-300" />
                </div>
                <div className="mt-4 text-[22px] font-black tracking-[0] text-white sm:mt-5 sm:text-[24px]">{latestAnalysisDate}</div>
              </article>
            </section>

            <section className={`${solidCardClass} mt-6`}>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-[22px] font-black tracking-[0] text-white sm:text-[24px]">История анализов</h2>
                  <p className="mt-2 text-[15px] text-gray-400">Последние сохраненные отчеты вашего аккаунта.</p>
                </div>
                {historyLoading && <div className="text-sm text-gray-400">Обновляем...</div>}
              </div>

              {historyError && (
                <div className="mt-5 rounded-2xl border border-[#5B2730] bg-[rgba(91,39,48,0.22)] px-5 py-4 text-[15px] text-[#FFD1D8]">
                  {historyError}
                </div>
              )}

              {profileMessage && (
                <div className="mt-5 rounded-2xl border border-white/12 bg-white/6 px-5 py-4 text-[15px] text-gray-200">
                  {profileMessage}
                </div>
              )}

              {!historyLoading && history.length === 0 && !historyError && (
                <p className="mt-5 text-[15px] text-gray-400">Сохраненных анализов пока нет.</p>
              )}

              {history.length > 0 && (
                <div className="mt-6 grid gap-3 md:grid-cols-2">
                  {history.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => void openSavedAnalysis(item.id)}
                      className="rounded-[16px] border border-white/10 bg-black/20 px-4 py-4 text-left transition-colors hover:border-white/18 hover:bg-black/30 sm:px-5 sm:py-5"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="break-all text-[17px] font-bold text-white sm:text-[18px]">@{item.username.toUpperCase()}</div>
                          <div className="mt-2 text-[14px] text-gray-400">{item.niche || 'Без ниши'}</div>
                        </div>
                        <div className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[13px] font-semibold text-gray-200">
                          {item.compatibilityScore ?? '—'}%
                        </div>
                      </div>
                      <div className="mt-4 text-[14px] text-gray-400">{formatAnalysisDate(item.createdAt)}</div>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="mt-6 rounded-[18px] border border-[#5B2730] bg-[rgba(91,39,48,0.16)] p-5 sm:p-7 lg:p-8">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-[21px] font-black tracking-[0] text-white sm:text-[22px]">Очистить анализы</h2>
                  <p className="mt-2 max-w-[680px] text-[15px] leading-[1.45] text-[#FFD1D8]">
                    Удалит всю историю отчетов и локальный кэш анализов для вашего аккаунта. Профиль и вход останутся без изменений.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleClearAnalyses()}
                  disabled={clearAnalysesLoading || history.length === 0}
                  className="inline-flex h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-[#FF4C64] px-5 text-[15px] font-bold text-white transition-colors hover:bg-[#ff6378] disabled:cursor-not-allowed disabled:opacity-55 sm:w-fit sm:px-6"
                >
                  <Trash2 size={17} />
                  {clearAnalysesLoading ? 'Очищаем...' : 'Очистить анализы'}
                </button>
              </div>
            </section>
          </div>
        )}

        {screen === 'loading' && (
          <div className="mx-auto flex min-h-[62vh] w-full max-w-[980px] flex-col items-center justify-center py-20 text-center">
            <AnalysisPreloader />
            <div className="hidden h-[210px] w-[210px] items-center justify-center sm:h-[250px] sm:w-[250px]">
              <div className="loading-orbit loading-orbit-outer"></div>
              <div className="loading-orbit loading-orbit-inner"></div>
              <div className="loading-sweep"></div>
              <div className="relative z-10 flex h-[116px] w-[116px] items-center justify-center rounded-full border border-white/18 bg-[#141419] shadow-[0_24px_80px_rgba(0,0,0,0.42)]">
                <div className="absolute inset-4 rounded-full border border-white/10"></div>
                <Sparkles size={34} className="loading-spark text-white" strokeWidth={2.2} />
              </div>
            </div>

            <div className="mt-2 inline-flex min-h-[42px] items-center gap-3 rounded-full border border-white/12 bg-white/6 px-5 text-[14px] font-semibold text-gray-200">
              <span className="h-2 w-2 rounded-full bg-white/55"></span>
              Анализ профиля запущен
            </div>

            <h2 className="mt-6 text-[26px] font-black leading-[1.08] tracking-[0] text-white sm:mt-7 sm:text-[42px] sm:leading-[1.05]">
              Собираем персональный разбор
            </h2>
            <p className="mt-5 max-w-[620px] text-[16px] leading-[1.55] text-gray-400 sm:text-[18px]">
              Проверяем профиль, считываем контент-сигналы и подбираем идеи, которые подходят именно под вашу нишу.
            </p>

            <div className="mt-10 w-full max-w-[640px] overflow-hidden rounded-full border border-white/10 bg-white/8 p-1">
              <div className="loading-progress h-[8px] rounded-full bg-white/10"></div>
            </div>

            <div className="mt-8 grid w-full max-w-[780px] grid-cols-1 gap-3 text-left sm:grid-cols-3">
              {[
                ['01', 'Профиль', 'Данные и описание'],
                ['02', 'Контент', 'Посты и реакции'],
                ['03', 'Идеи', 'Тренды и хуки'],
              ].map(([step, title, description]) => (
                <div key={step} className="rounded-[16px] border border-white/10 bg-[#15151A] px-5 py-4">
                  <div className="text-[12px] font-black text-gray-300">{step}</div>
                  <div className="mt-2 text-[16px] font-bold text-white">{title}</div>
                  <div className="mt-1 text-[13px] text-gray-500">{description}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {screen === 'results' && report && primaryIdea && (
          <div className={`${pageClass} mt-4 sm:mt-6`}>
            <div className="flex flex-col items-start gap-4">
              <button
                onClick={handleBack}
                className={secondaryButtonClass}
              >
                <ArrowLeft size={20} />
                Назад
              </button>

              <div className="flex min-h-[48px] w-full flex-wrap items-center gap-3 rounded-2xl border border-white/24 bg-[rgba(28,28,34,0.78)] px-4 py-3 text-[14px] font-medium leading-[1.35] text-gray-200 shadow-[0_10px_30px_rgba(0,0,0,0.25)] sm:min-h-[58px] sm:w-fit sm:rounded-full sm:px-5 sm:py-0 sm:text-[16px]">
                <span className="h-2 w-2 rounded-full bg-white/55"></span>
                {report.cached ? 'Результат из сохранённого анализа' : 'Персональный анализ готов'}
              </div>
            </div>

            <section className={`${solidCardClass} mt-6`}>
              <div className="flex flex-col gap-7 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-8">
                  {report.account.profilePicUrl && !avatarLoadFailed ? (
                    <img
                      src={report.account.profilePicUrl}
                      alt={displayUsername}
                      className="h-[104px] w-[104px] shrink-0 rounded-full object-cover sm:h-[132px] sm:w-[132px] lg:h-[146px] lg:w-[146px]"
                      onError={() => setAvatarLoadFailed(true)}
                    />
                  ) : (
                    <div className="flex h-[104px] w-[104px] shrink-0 items-center justify-center rounded-full bg-[#D9D9D9] text-[34px] font-black text-black sm:h-[132px] sm:w-[132px] sm:text-[40px] lg:h-[146px] lg:w-[146px] lg:text-[44px]">
                      {getInitials(displayUsername)}
                    </div>
                  )}

                  <div className="pt-1">
                    <h2 className="break-all text-[24px] font-black uppercase tracking-[0] text-white sm:text-[28px]">
                      @{displayUsername.toUpperCase()}
                    </h2>
                    <p className="mt-3 text-[16px] leading-[1.35] text-gray-300 [overflow-wrap:anywhere] sm:text-[18px]">
                      {displayNiche} · {report.account.platform}
                    </p>

                    <div className="mt-5 flex flex-wrap gap-3 text-sm text-gray-400 sm:mt-6">
                      <span>Обновлено: {formatAnalysisDate(report.createdAt)}</span>
                    </div>

                    <div className="mt-6 max-w-[760px] space-y-3 text-[15px] leading-[1.5] text-[#B8B8C0] sm:mt-8">
                      <p>{report.analysis.profileSummary.positioning}</p>
                      <p>{report.analysis.profileSummary.audienceSummary}</p>
                    </div>

                    <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-3 md:gap-8 lg:mt-10 lg:gap-12">
                      <div>
                        <div className="text-[24px] font-black leading-[1.15] tracking-[0] text-white [overflow-wrap:anywhere] sm:text-[26px] lg:text-[28px]">
                          {formatCompactNumber(report.account.followersCount)}
                        </div>
                        <div className="mt-4 text-[16px] text-gray-300">Подписчики</div>
                      </div>
                      <div>
                        <div className="text-[24px] font-black leading-[1.15] tracking-[0] text-white [overflow-wrap:anywhere] sm:text-[26px] lg:text-[28px]">
                          {displayNiche}
                        </div>
                        <div className="mt-4 text-[16px] text-gray-300">Ниша</div>
                      </div>
                      <div>
                        <div className="text-[24px] font-black leading-[1.15] tracking-[0] text-white [overflow-wrap:anywhere] sm:text-[26px] lg:text-[28px]">
                          {report.analysis.profileSummary.compatibilityLabel} {report.analysis.profileSummary.compatibilityScore}%
                        </div>
                        <div className="mt-4 text-[16px] text-gray-300">Совместимость</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="inline-flex h-[48px] w-full items-center justify-center rounded-[16px] border border-white/24 bg-[rgba(39,39,46,0.7)] px-6 text-[16px] font-bold text-white sm:h-[54px] sm:w-fit sm:min-w-[176px] sm:px-8 sm:text-[18px]">
                  {report.account.platform}
                </div>
              </div>
            </section>

            <section className="mt-10 sm:mt-12">
              <h3 className={`${sectionTitleClass} mb-5 sm:mb-6`}>
                <Flame size={24} className={iconTitleClass} />
                Актуальные тренды
              </h3>

              <div className="grid grid-cols-1 gap-[18px] md:grid-cols-2">
                {report.analysis.trends.map((trend, index) => (
                  <article
                    key={`${trend.title}-${index}`}
                    className="flex flex-col rounded-[18px] border border-white/10 bg-[#15151A] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.16)] sm:min-h-[240px] sm:p-7 lg:p-8"
                  >
                    <div
                      className={`inline-flex h-[36px] w-fit items-center gap-2 rounded-[14px] px-4 text-[12px] font-black uppercase tracking-[0] sm:h-[38px] sm:text-[13px] ${
                        trend.type === 'top' ? 'bg-[#5B2730] text-[#FF4C64]' : 'bg-white/8 text-gray-200'
                      }`}
                    >
                      {trend.type === 'top' ? <Flame size={16} strokeWidth={2.4} /> : <TrendingUp size={16} strokeWidth={2.4} />}
                      {trend.type === 'top' ? 'Топ' : 'Растёт'}
                    </div>
                    <div className="mt-6 sm:mt-8">
                      <h4 className="text-[20px] font-bold leading-[1.2] text-white">{trend.title}</h4>
                      <p className="mt-3 max-w-[400px] text-[15px] leading-[1.4] text-gray-200 sm:mt-4 sm:text-[17px] sm:leading-[1.3]">{trend.description}</p>
                    </div>
                    <div className="mt-auto pt-7 sm:pt-9">
                      <div className="mb-3 text-[14px] font-medium text-gray-300">{trend.match}% совпадение</div>
                      <div className="h-[3px] w-full rounded-full bg-white/18">
                        <div className="h-[3px] rounded-full bg-white/70" style={{width: `${trend.match}%`}}></div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="mt-10 sm:mt-12">
              <h3 className={`${sectionTitleClass} mb-5 sm:mb-6`}>
                <Lightbulb size={24} className={iconTitleClass} />
                Идеи видео
              </h3>

              <article className={`${solidCardClass} relative overflow-hidden`}>
                <div className="absolute inset-y-4 left-0 w-[3px] rounded-full bg-[#FF4967]"></div>
                <div className="inline-flex min-h-[30px] w-fit items-center rounded-[999px] bg-[#5B2730] px-4 py-1 text-[12px] font-black uppercase tracking-[0] text-[#FF4C64] sm:px-6 sm:text-[13px]">
                  {primaryIdea.tag}
                </div>
                <h4 className="mt-5 text-[20px] font-bold leading-[1.25] text-white">{primaryIdea.title}</h4>
                <div className="mt-8 text-[15px] font-semibold text-[#6B6B76]">Хук (первые 3 секунды)</div>
                <div className="mt-4 rounded-[14px] bg-black px-4 py-4 text-[15px] leading-[1.4] text-gray-300 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)] sm:mt-5 sm:rounded-[16px] sm:px-6 sm:py-5 sm:text-[16px]">
                  {primaryIdea.hook}
                </div>
                <div className="mt-6 text-[15px] leading-[1.4] text-[#B8B8C0]">{primaryIdea.angle}</div>
              </article>

              {secondaryIdeas.length > 0 && (
                <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                  {secondaryIdeas.map((idea, index) => (
                    <article key={`${idea.title}-${index}`} className="rounded-[18px] border border-white/10 bg-[#15151A] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.16)] sm:p-6">
                      <div className="inline-flex rounded-full bg-white/8 px-4 py-2 text-[12px] font-bold uppercase tracking-[0] text-white">
                        {idea.tag}
                      </div>
                      <h4 className="mt-4 text-[18px] font-bold text-white">{idea.title}</h4>
                      <p className="mt-3 text-[15px] leading-[1.35] text-[#B8B8C0]">{idea.angle}</p>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="mt-10 sm:mt-12">
              <h3 className={`${sectionTitleClass} mb-5 sm:mb-6`}>
                <Zap size={23} className={iconTitleClass} />
                Хуки для захвата внимания
              </h3>

              <div className="grid grid-cols-1 gap-[10px] md:grid-cols-2">
                {report.analysis.hooks.map((hook, index) => (
                  <article key={`${hook}-${index}`} className="min-h-[84px] rounded-[12px] border border-white/10 bg-[#15151A] p-5 shadow-[0_16px_36px_rgba(0,0,0,0.14)] sm:min-h-[92px] sm:px-6">
                    <div className="text-[13px] font-medium text-[#6D6D78]">{String(index + 1).padStart(2, '0')}</div>
                    <div className="mt-3 max-w-[460px] text-[15px] font-medium leading-[1.35] text-white sm:leading-[1.25]">{hook}</div>
                  </article>
                ))}
              </div>
            </section>

            <section className="mt-10 sm:mt-12">
              <h3 className={`${sectionTitleClass} mb-5 sm:mb-6`}>
                <Heart size={23} className={iconTitleClass} />
                Общие рекомендации
              </h3>

              <article className={solidCardClass}>
                <div className={`overflow-hidden text-[15px] leading-[1.5] text-[#B8B8C0] ${isAdviceExpanded ? 'max-h-none' : 'max-h-[220px]'}`}>
                  <p>{report.analysis.recommendations.summary}</p>
                  {report.analysis.recommendations.bullets.map((line, index) => (
                    <p key={`${line}-${index}`} className="mt-3">
                      {index + 1}. {line}
                    </p>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setIsAdviceExpanded((value) => !value)}
                  className="mt-6 inline-flex h-[32px] items-center justify-center rounded-[7px] bg-[#E7E7E7] px-7 text-[14px] font-bold text-black transition-colors hover:bg-white"
                >
                  {isAdviceExpanded ? 'Свернуть' : 'Развернуть'}
                </button>

                {report.sources.length > 0 && (
                  <div className="mt-6 border-t border-white/10 pt-5 text-[13px] leading-[1.45] text-[#8E8E97] [overflow-wrap:anywhere]">
                    Источники: {report.sources.map((source) => source.title).join(' · ')}
                  </div>
                )}
              </article>
            </section>
          </div>
        )}
      </main>

      <footer className="relative z-10 mt-auto border-t border-white/10 bg-[#15151A]">
        <div className="mx-auto flex w-full max-w-[1184px] flex-col gap-8 px-6 py-10 sm:px-8 sm:py-12 lg:flex-row lg:justify-between lg:px-10">
          <div className="max-w-[420px]">
            <div className="flex items-center gap-3 sm:gap-4">
              <img src={aligndLogo} alt="Alignd" className="h-[44px] w-auto object-contain sm:h-[52px]" />
              <div className="text-[22px] font-black tracking-[0] text-white">Alignd</div>
            </div>
            <p className="mt-5 text-[16px] leading-[1.4] text-[#A2A2AA]">
              Сервис для анализа Instagram и TikTok профилей, идей контента и персональных рекомендаций для роста.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-8 text-[15px] text-[#A2A2AA] sm:grid-cols-3 sm:gap-x-12 sm:gap-y-10">
            <div>
              <div className="mb-4 font-semibold text-[#D0D0D6]">Продукт</div>
              <div className="space-y-2">
                <div>Аналитика</div>
                <div>История отчётов</div>
              </div>
            </div>
            <div>
              <div className="mb-4 font-semibold text-[#D0D0D6]">Форматы</div>
              <div className="space-y-2">
                <div>Тренды</div>
                <div>Хуки</div>
              </div>
            </div>
            <div>
              <div className="mb-4 font-semibold text-[#D0D0D6]">Результат</div>
              <div className="space-y-2">
                <div>Идеи видео</div>
                <div>Рекомендации</div>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
