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
import {clearStoredToken, getStoredToken, setStoredToken} from './lib/auth';
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

  const details = (payload as {details?: unknown}).details;
  if (typeof details === 'string' && details.trim()) {
    return `${error} ${details}`.trim();
  }

  if (details && typeof details === 'object' && 'message' in details && typeof details.message === 'string') {
    return `${error} ${details.message}`.trim();
  }

  return error;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, options);
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
        <span className="h-2 w-2 rounded-full bg-[#4FD5B2] shadow-[0_0_12px_rgba(79,213,178,0.9)]"></span>
        Анализ профиля запущен
      </div>

      <h2 className="mt-7 text-[30px] font-black leading-[1.05] tracking-[-0.02em] text-white sm:text-[42px]">
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
            <div className="text-[12px] font-black text-[#4FD5B2]">{step}</div>
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

  const loadHistory = async (authToken: string) => {
    setHistoryLoading(true);
    setHistoryError('');

    try {
      const payload = await fetchJson<{items: AnalysisHistoryItem[]}>(`${API_BASE_URL}/analyses`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
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
      const payload = await fetchJson<AnalysisResponse>(`${API_BASE_URL}/analyses/${analysisId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      setReport(payload);
      setUrl(payload.account.profileUrl || '');
      setNiche(payload.analysis.profileSummary.niche || payload.account.niche || '');
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
    const storedToken = getStoredToken();

    if (!storedToken) {
      setAuthLoading(false);
      return;
    }

    setToken(storedToken);

    fetchJson<{user: User}>(`${API_BASE_URL}/auth/me`, {
      headers: {
        Authorization: `Bearer ${storedToken}`,
      },
    })
      .then((payload) => {
        setUser(payload.user);
        return loadHistory(storedToken);
      })
      .catch((error) => {
        if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
          clearStoredToken();
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
    if (screen !== 'results' || !report) {
      return;
    }

    window.requestAnimationFrame(() => {
      window.scrollTo({top: 0, left: 0, behavior: 'auto'});
    });
  }, [screen, report]);

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

      setStoredToken(payload.token);
      setToken(payload.token);
      setUser(payload.user);
      setPassword('');
      setAuthMode('login');
      await loadHistory(payload.token);
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
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } catch {
      // Ignore server-side logout failures and clear the client session anyway.
    }

    clearStoredToken();
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
        headers: {
          Authorization: `Bearer ${token}`,
        },
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
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          profileUrl: url.trim(),
          niche: niche.trim(),
        }),
      });

      setReport(payload);
      setScreen('results');
      setPreloaderMode(null);
      await loadHistory(token);
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
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#050507] font-sans text-white selection:bg-white/20">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#050507]/94 px-6 backdrop-blur-md">
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
              <span className="h-2 w-2 rounded-full bg-[#4FD5B2] shadow-[0_0_12px_rgba(79,213,178,0.9)]"></span>
              Анализ профиля запущен
            </div>

            <h2 className="mt-7 text-[30px] font-black leading-[1.05] tracking-[-0.02em] text-white sm:text-[42px]">
              Собираем персональный разбор
            </h2>
            <p className="mt-5 max-w-[620px] text-[16px] leading-[1.55] text-gray-400 sm:text-[18px]">
              Проверяем профиль, считываем контент-сигналы и подбираем идеи, которые подходят именно под вашу нишу.
            </p>

            <div className="mt-10 w-full max-w-[640px] overflow-hidden rounded-full border border-white/10 bg-white/8 p-1">
              <div className="loading-progress h-[8px] rounded-full bg-[#4FD5B2]"></div>
            </div>
          </div>
        </div>
      )}

      <header className="relative z-10 mx-auto flex w-full max-w-[1280px] items-center justify-between px-6 pb-4 pt-6 md:px-12">
        <button
          type="button"
          onClick={() => setScreen('home')}
          className="inline-flex items-center gap-3"
          aria-label="Alignd home"
        >
          <img src={aligndLogo} alt="Alignd" className="h-[42px] w-auto object-contain" />
          <span className="text-[28px] font-black tracking-[-0.05em] text-white">Alignd</span>
        </button>
        {authLoading ? (
          <div className="text-sm text-gray-400">Проверяем сессию...</div>
        ) : user ? (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleOpenProfile}
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/6 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-white/10"
            >
              <UserRound size={16} />
              <span className="hidden sm:inline">{user.displayName}</span>
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/6 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-white/10"
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

      <main className="relative z-10 mx-auto flex-1 w-full max-w-[1280px] px-6 pb-20 md:px-12">
        {screen === 'home' && (
          <div className="flex flex-col">
            <section className="relative mb-20 mt-6 grid gap-10 lg:grid-cols-[minmax(720px,1fr)_440px] lg:items-center lg:gap-6">
              <div className="max-w-[860px]">
                <div className="mb-8 inline-flex items-center gap-3 rounded-full border border-white/18 bg-white/[0.03] px-6 py-2.5 text-[15px] font-medium text-gray-300 shadow-[0_12px_40px_rgba(0,0,0,0.25)] backdrop-blur-md">
                  <Sparkles size={16} />
                  Анализ профиля, тренды и идеи под ваш контент
                </div>

                <h1 className="max-w-[820px] text-[58px] font-bold leading-[0.95] tracking-[-0.055em] text-white sm:text-[68px] lg:text-[84px]">
                  Создавай контент,
                  <br />
                  который попадает в тренд
                </h1>

                <p className="mt-7 max-w-[760px] text-[21px] leading-[1.35] text-gray-300">
                  Получайте персональный анализ Instagram или TikTok профиля, идеи для роликов,
                  цепляющие хуки и рекомендации для роста.
                </p>

                <button
                  type="button"
                  onClick={scrollToForm}
                  className="mt-10 inline-flex rounded-[18px] bg-[#ECECEC] px-11 py-[21px] text-[20px] font-bold text-black shadow-[0_18px_60px_rgba(255,255,255,0.08)] transition-colors hover:bg-white"
                >
                  Начать анализ
                </button>
              </div>

              <div className="relative flex justify-center lg:justify-end">
                <img
                  src={heroLiquid}
                  alt="Abstract glossy liquid shape"
                  className="w-full max-w-[500px] object-contain drop-shadow-[0_30px_90px_rgba(0,0,0,0.65)]"
                />
              </div>
            </section>

            {!user && !authLoading && (
              <section className="mb-10 rounded-[22px] border border-white/10 bg-[rgba(18,18,24,0.9)] p-7 shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur-md">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-[28px] font-black tracking-[-0.04em] text-white">Аккаунт</h2>
                    <p className="mt-2 max-w-[520px] text-[15px] text-gray-400">
                      Зарегистрируйтесь или войдите, чтобы запускать анализ и сохранять историю отчётов.
                    </p>
                  </div>

                  <div className="inline-flex rounded-full border border-white/10 bg-black/30 p-1">
                    <button
                      type="button"
                      onClick={() => setAuthMode('register')}
                      className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                        authMode === 'register' ? 'bg-white text-black' : 'text-gray-300'
                      }`}
                    >
                      Регистрация
                    </button>
                    <button
                      type="button"
                      onClick={() => setAuthMode('login')}
                      className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                        authMode === 'login' ? 'bg-white text-black' : 'text-gray-300'
                      }`}
                    >
                      Вход
                    </button>
                  </div>
                </div>

                <form onSubmit={handleAuthSubmit} className="mt-6 grid gap-4 md:grid-cols-2">
                  {authMode === 'register' && (
                    <input
                      type="text"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      placeholder="Ваше имя"
                      className="h-[58px] rounded-xl border border-white/12 bg-[rgba(255,255,255,0.06)] px-5 text-[16px] text-gray-200 placeholder:text-gray-500 focus:border-white/28 focus:outline-none"
                      required
                    />
                  )}
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="Email"
                    className="h-[58px] rounded-xl border border-white/12 bg-[rgba(255,255,255,0.06)] px-5 text-[16px] text-gray-200 placeholder:text-gray-500 focus:border-white/28 focus:outline-none"
                    required
                  />
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Пароль"
                    className="h-[58px] rounded-xl border border-white/12 bg-[rgba(255,255,255,0.06)] px-5 text-[16px] text-gray-200 placeholder:text-gray-500 focus:border-white/28 focus:outline-none"
                    required
                  />
                  <button
                    type="submit"
                    disabled={authSubmitting}
                    className="h-[58px] rounded-xl bg-[#ECECEC] px-8 text-[17px] font-bold text-black transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-70"
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
              className="rounded-[22px] border border-white/10 bg-[rgba(20,20,26,0.9)] p-7 shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur-md"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-[28px] font-black tracking-[-0.04em] text-white">Новый анализ</h2>
                  <p className="mt-2 text-[15px] text-gray-400">
                    Вставьте ссылку на профиль и опишите нишу, чтобы получить точный разбор.
                  </p>
                </div>
                {user && (
                  <div className="rounded-full border border-white/12 bg-white/6 px-4 py-2 text-sm text-gray-200">
                    {user.email}
                  </div>
                )}
              </div>

              <form onSubmit={handleAnalyze} className="mt-6 space-y-6">
                <div>
                  <label className="mb-4 block text-[18px] font-bold text-white">Ссылка на профиль</label>
                  <div className="flex flex-col gap-4 md:flex-row md:items-center">
                    <input
                      type="text"
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder="Instagram или TikTok URL"
                      className="h-[62px] flex-1 rounded-xl border border-white/12 bg-[rgba(255,255,255,0.06)] px-6 text-[18px] text-gray-200 placeholder:text-gray-500 focus:border-white/28 focus:outline-none"
                      required
                    />
                    <button
                      type="submit"
                      disabled={!user}
                      className="h-[62px] rounded-xl bg-[#ECECEC] px-10 text-[18px] font-bold text-black transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 md:min-w-[250px]"
                    >
                      Анализировать
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-4 block text-[18px] font-bold text-white">Ниша</label>
                  <input
                    type="text"
                    value={niche}
                    onChange={(event) => setNiche(event.target.value)}
                    placeholder="Например: маркетинг для малого бизнеса"
                    className="h-[62px] w-full rounded-xl border border-white/12 bg-[rgba(255,255,255,0.06)] px-6 text-[18px] text-gray-200 placeholder:text-gray-500 focus:border-white/28 focus:outline-none"
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
              <section className="mt-10 rounded-[22px] border border-white/10 bg-[rgba(18,18,24,0.88)] p-7 shadow-[0_24px_60px_rgba(0,0,0,0.28)]">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <h2 className="text-[24px] font-black tracking-[-0.04em] text-white">Последние анализы</h2>
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
                        className="rounded-[18px] border border-white/10 bg-black/20 px-5 py-5 text-left transition-colors hover:border-white/18 hover:bg-black/30"
                      >
                        <div className="text-[18px] font-bold text-white">@{item.username.toUpperCase()}</div>
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
          <div className="mx-auto mt-8 w-full max-w-[1128px] pb-28">
            <button
              type="button"
              onClick={() => setScreen('home')}
              className="inline-flex h-[52px] items-center gap-3 rounded-xl border border-white/18 bg-white/6 px-6 text-[16px] font-medium text-gray-100 transition-colors hover:bg-white/10"
            >
              <ArrowLeft size={18} />
              Назад
            </button>

            <section className="mt-8 rounded-[18px] border border-white/12 bg-[#15151A] px-7 py-8 shadow-[0_20px_60px_rgba(0,0,0,0.25)] md:px-10">
              <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
                  <div className="flex h-[112px] w-[112px] shrink-0 items-center justify-center rounded-full bg-[#E7E7E7] text-[34px] font-black text-black">
                    {getInitials(user.displayName)}
                  </div>
                  <div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/6 px-4 py-2 text-[13px] font-semibold text-gray-300">
                      <Shield size={15} />
                      Аккаунт активен
                    </div>
                    <h1 className="mt-5 text-[34px] font-black tracking-[-0.045em] text-white md:text-[44px]">
                      {user.displayName}
                    </h1>
                    <div className="mt-4 flex flex-wrap gap-3 text-[15px] text-gray-300">
                      <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2">
                        <Mail size={15} />
                        {user.email}
                      </span>
                      <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2">
                        <CalendarDays size={15} />
                        С нами с {formatAnalysisDate(user.createdAt)}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex h-[50px] items-center justify-center gap-2 rounded-xl border border-white/14 bg-white/6 px-6 text-[15px] font-semibold text-gray-100 transition-colors hover:bg-white/10"
                >
                  <LogOut size={17} />
                  Выйти
                </button>
              </div>
            </section>

            <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
              <article className="rounded-[16px] border border-white/10 bg-[#15151A] px-6 py-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="text-[14px] font-semibold text-gray-400">Всего анализов</div>
                  <BarChart3 size={20} className="text-[#49CFAF]" />
                </div>
                <div className="mt-5 text-[36px] font-black tracking-[-0.04em] text-white">{history.length}</div>
              </article>

              <article className="rounded-[16px] border border-white/10 bg-[#15151A] px-6 py-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="text-[14px] font-semibold text-gray-400">Средняя совместимость</div>
                  <TrendingUp size={20} className="text-[#49CFAF]" />
                </div>
                <div className="mt-5 text-[36px] font-black tracking-[-0.04em] text-white">
                  {averageCompatibility ? `${averageCompatibility}%` : '—'}
                </div>
              </article>

              <article className="rounded-[16px] border border-white/10 bg-[#15151A] px-6 py-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="text-[14px] font-semibold text-gray-400">Последний отчет</div>
                  <CalendarDays size={20} className="text-[#49CFAF]" />
                </div>
                <div className="mt-5 text-[24px] font-black tracking-[-0.03em] text-white">{latestAnalysisDate}</div>
              </article>
            </section>

            <section className="mt-6 rounded-[18px] border border-white/12 bg-[#15151A] px-7 py-7 shadow-[0_20px_60px_rgba(0,0,0,0.18)] md:px-10">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-[24px] font-black tracking-[-0.04em] text-white">История анализов</h2>
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
                <div className="mt-5 rounded-2xl border border-[#1E4D37] bg-[rgba(30,77,55,0.22)] px-5 py-4 text-[15px] text-[#BFF5DD]">
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
                      className="rounded-[16px] border border-white/10 bg-black/20 px-5 py-5 text-left transition-colors hover:border-white/18 hover:bg-black/30"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-[18px] font-bold text-white">@{item.username.toUpperCase()}</div>
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

            <section className="mt-6 rounded-[18px] border border-[#5B2730] bg-[rgba(91,39,48,0.16)] px-7 py-7 md:px-10">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-[22px] font-black tracking-[-0.035em] text-white">Очистить анализы</h2>
                  <p className="mt-2 max-w-[680px] text-[15px] leading-[1.45] text-[#FFD1D8]">
                    Удалит всю историю отчетов и локальный кэш анализов для вашего аккаунта. Профиль и вход останутся без изменений.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleClearAnalyses()}
                  disabled={clearAnalysesLoading || history.length === 0}
                  className="inline-flex h-[52px] items-center justify-center gap-2 rounded-xl bg-[#FF4C64] px-6 text-[15px] font-bold text-white transition-colors hover:bg-[#ff6378] disabled:cursor-not-allowed disabled:opacity-55"
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
              <span className="h-2 w-2 rounded-full bg-[#4FD5B2] shadow-[0_0_12px_rgba(79,213,178,0.9)]"></span>
              Анализ профиля запущен
            </div>

            <h2 className="mt-7 text-[30px] font-black leading-[1.05] tracking-[-0.02em] text-white sm:text-[42px]">
              Собираем персональный разбор
            </h2>
            <p className="mt-5 max-w-[620px] text-[16px] leading-[1.55] text-gray-400 sm:text-[18px]">
              Проверяем профиль, считываем контент-сигналы и подбираем идеи, которые подходят именно под вашу нишу.
            </p>

            <div className="mt-10 w-full max-w-[640px] overflow-hidden rounded-full border border-white/10 bg-white/8 p-1">
              <div className="loading-progress h-[8px] rounded-full bg-[#4FD5B2]"></div>
            </div>

            <div className="mt-8 grid w-full max-w-[780px] grid-cols-1 gap-3 text-left sm:grid-cols-3">
              {[
                ['01', 'Профиль', 'Данные и описание'],
                ['02', 'Контент', 'Посты и реакции'],
                ['03', 'Идеи', 'Тренды и хуки'],
              ].map(([step, title, description]) => (
                <div key={step} className="rounded-[16px] border border-white/10 bg-[#15151A] px-5 py-4">
                  <div className="text-[12px] font-black text-[#4FD5B2]">{step}</div>
                  <div className="mt-2 text-[16px] font-bold text-white">{title}</div>
                  <div className="mt-1 text-[13px] text-gray-500">{description}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {screen === 'results' && report && primaryIdea && (
          <div className="mx-auto mt-[22px] w-full max-w-[1128px] pb-28">
            <div className="flex flex-col items-start gap-4">
              <button
                onClick={handleBack}
                className="inline-flex h-[58px] items-center gap-3 rounded-xl border border-white/24 bg-[rgba(19,19,24,0.72)] px-7 text-[18px] font-medium text-gray-100 transition-colors hover:bg-[rgba(27,27,34,0.9)]"
              >
                <ArrowLeft size={20} />
                Назад
              </button>

              <div className="flex min-h-[58px] flex-wrap items-center gap-3 rounded-full border border-white/24 bg-[rgba(28,28,34,0.78)] px-5 text-[16px] font-medium text-gray-200 shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
                <span className="h-2 w-2 rounded-full bg-[#4FD5B2] shadow-[0_0_10px_rgba(79,213,178,0.9)]"></span>
                {report.cached ? 'Результат из сохранённого анализа' : 'Персональный анализ готов'}
              </div>
            </div>

            <section className="mt-[48px] rounded-[18px] border border-white/12 bg-[#15151A] px-10 py-11 shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
              <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex flex-col gap-8 sm:flex-row sm:items-start">
                  {report.account.profilePicUrl && !avatarLoadFailed ? (
                    <img
                      src={report.account.profilePicUrl}
                      alt={displayUsername}
                      className="h-[146px] w-[146px] shrink-0 rounded-full object-cover"
                      onError={() => setAvatarLoadFailed(true)}
                    />
                  ) : (
                    <div className="flex h-[146px] w-[146px] shrink-0 items-center justify-center rounded-full bg-[#D9D9D9] text-[44px] font-black text-black">
                      {getInitials(displayUsername)}
                    </div>
                  )}

                  <div className="pt-1">
                    <h2 className="text-[28px] font-black uppercase tracking-[-0.04em] text-white">
                      @{displayUsername.toUpperCase()}
                    </h2>
                    <p className="mt-3 text-[18px] leading-[1.3] text-gray-300">
                      {displayNiche} · {report.account.platform}
                    </p>

                    <div className="mt-6 flex flex-wrap gap-3 text-sm text-gray-400">
                      <span>Обновлено: {formatAnalysisDate(report.createdAt)}</span>
                    </div>

                    <div className="mt-8 max-w-[760px] space-y-3 text-[15px] leading-[1.45] text-[#B8B8C0]">
                      <p>{report.analysis.profileSummary.positioning}</p>
                      <p>{report.analysis.profileSummary.audienceSummary}</p>
                    </div>

                    <div className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-3 sm:gap-12">
                      <div>
                        <div className="text-[28px] font-black tracking-[-0.04em] text-white">
                          {formatCompactNumber(report.account.followersCount)}
                        </div>
                        <div className="mt-4 text-[16px] text-gray-300">Подписчики</div>
                      </div>
                      <div>
                        <div className="text-[28px] font-black tracking-[-0.04em] text-white">
                          {displayNiche}
                        </div>
                        <div className="mt-4 text-[16px] text-gray-300">Ниша</div>
                      </div>
                      <div>
                        <div className="text-[28px] font-black tracking-[-0.04em] text-white">
                          {report.analysis.profileSummary.compatibilityLabel} {report.analysis.profileSummary.compatibilityScore}%
                        </div>
                        <div className="mt-4 text-[16px] text-gray-300">Совместимость</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="inline-flex h-[54px] min-w-[176px] items-center justify-center rounded-[16px] border border-white/24 bg-[rgba(39,39,46,0.7)] px-8 text-[18px] font-bold text-white">
                  {report.account.platform}
                </div>
              </div>
            </section>

            <section className="mt-[64px]">
              <h3 className="mb-8 flex items-center gap-4 text-[28px] font-black uppercase tracking-[-0.045em] text-white">
                <Flame size={28} className="text-white" />
                Актуальные тренды
              </h3>

              <div className="grid grid-cols-1 gap-[18px] md:grid-cols-2">
                {report.analysis.trends.map((trend, index) => (
                  <article
                    key={`${trend.title}-${index}`}
                    className="flex min-h-[286px] flex-col rounded-[18px] border border-white/12 bg-[#15151A] px-10 py-10 shadow-[0_20px_60px_rgba(0,0,0,0.16)]"
                  >
                    <div
                      className={`inline-flex h-[38px] w-fit items-center gap-2 rounded-[14px] px-4 text-[13px] font-black uppercase tracking-[-0.01em] ${
                        trend.type === 'top' ? 'bg-[#5B2730] text-[#FF4C64]' : 'bg-[#1E4D37] text-[#4CC287]'
                      }`}
                    >
                      {trend.type === 'top' ? <Flame size={16} strokeWidth={2.4} /> : <TrendingUp size={16} strokeWidth={2.4} />}
                      {trend.type === 'top' ? 'Топ' : 'Растёт'}
                    </div>
                    <div className="mt-[34px]">
                      <h4 className="text-[20px] font-bold leading-[1.2] text-white">{trend.title}</h4>
                      <p className="mt-4 max-w-[400px] text-[17px] leading-[1.3] text-gray-200">{trend.description}</p>
                    </div>
                    <div className="mt-auto pt-9">
                      <div className="mb-3 text-[14px] font-medium text-[#49CFAF]">{trend.match}% совпадение</div>
                      <div className="h-[3px] w-full rounded-full bg-white/18">
                        <div className="h-[3px] rounded-full bg-[#49CFAF]" style={{width: `${trend.match}%`}}></div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="mt-[66px]">
              <h3 className="mb-8 flex items-center gap-4 text-[28px] font-black uppercase tracking-[-0.045em] text-white">
                <Lightbulb size={28} className="text-white" />
                Идеи видео
              </h3>

              <article className="relative overflow-hidden rounded-[18px] border border-white/12 bg-[#15151A] px-10 py-10 shadow-[0_20px_60px_rgba(0,0,0,0.16)]">
                <div className="absolute inset-y-4 left-0 w-[3px] rounded-full bg-[#FF4967]"></div>
                <div className="inline-flex h-[30px] w-fit items-center rounded-[999px] bg-[#5B2730] px-6 text-[13px] font-black uppercase tracking-[-0.01em] text-[#FF4C64]">
                  {primaryIdea.tag}
                </div>
                <h4 className="mt-5 text-[20px] font-bold leading-[1.25] text-white">{primaryIdea.title}</h4>
                <div className="mt-8 text-[15px] font-semibold text-[#6B6B76]">Хук (первые 3 секунды)</div>
                <div className="mt-5 rounded-[16px] bg-black px-6 py-5 text-[16px] leading-[1.35] text-gray-300 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)]">
                  {primaryIdea.hook}
                </div>
                <div className="mt-6 text-[15px] leading-[1.4] text-[#B8B8C0]">{primaryIdea.angle}</div>
              </article>

              {secondaryIdeas.length > 0 && (
                <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                  {secondaryIdeas.map((idea, index) => (
                    <article key={`${idea.title}-${index}`} className="rounded-[18px] border border-white/12 bg-[#15151A] px-8 py-7 shadow-[0_20px_60px_rgba(0,0,0,0.16)]">
                      <div className="inline-flex rounded-full bg-white/8 px-4 py-2 text-[12px] font-bold uppercase tracking-[-0.01em] text-white">
                        {idea.tag}
                      </div>
                      <h4 className="mt-4 text-[18px] font-bold text-white">{idea.title}</h4>
                      <p className="mt-3 text-[15px] leading-[1.35] text-[#B8B8C0]">{idea.angle}</p>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="mt-[68px]">
              <h3 className="mb-8 flex items-center gap-4 text-[28px] font-black uppercase tracking-[-0.045em] text-white">
                <Zap size={26} className="text-white" />
                Хуки для захвата внимания
              </h3>

              <div className="grid grid-cols-1 gap-[10px] md:grid-cols-2">
                {report.analysis.hooks.map((hook, index) => (
                  <article key={`${hook}-${index}`} className="min-h-[92px] rounded-[12px] border border-white/12 bg-[#15151A] px-7 py-4 shadow-[0_16px_36px_rgba(0,0,0,0.14)]">
                    <div className="text-[13px] font-medium text-[#6D6D78]">{String(index + 1).padStart(2, '0')}</div>
                    <div className="mt-3 max-w-[460px] text-[15px] font-medium leading-[1.25] text-white">{hook}</div>
                  </article>
                ))}
              </div>
            </section>

            <section className="mt-[64px]">
              <h3 className="mb-8 flex items-center gap-4 text-[28px] font-black uppercase tracking-[-0.045em] text-white">
                <Heart size={26} className="text-white" />
                Общие рекомендации
              </h3>

              <article className="rounded-[18px] border border-white/12 bg-[#15151A] px-7 py-7 shadow-[0_20px_60px_rgba(0,0,0,0.16)] md:px-10 md:py-9">
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
                  <div className="mt-6 border-t border-white/10 pt-5 text-[13px] leading-[1.45] text-[#8E8E97]">
                    Источники: {report.sources.map((source) => source.title).join(' · ')}
                  </div>
                )}
              </article>
            </section>
          </div>
        )}
      </main>

      <footer className="relative z-10 mt-auto border-t border-white/10 bg-[#15151A]">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-10 px-6 py-12 md:px-12 lg:flex-row lg:justify-between">
          <div className="max-w-[420px]">
            <div className="flex items-center gap-4">
              <img src={aligndLogo} alt="Alignd" className="h-[52px] w-auto object-contain" />
              <div className="text-[22px] font-black tracking-[-0.04em] text-white">Alignd</div>
            </div>
            <p className="mt-5 text-[16px] leading-[1.4] text-[#A2A2AA]">
              Сервис для анализа Instagram и TikTok профилей, идей контента и персональных рекомендаций для роста.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-12 gap-y-10 text-[15px] text-[#A2A2AA] sm:grid-cols-3">
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
