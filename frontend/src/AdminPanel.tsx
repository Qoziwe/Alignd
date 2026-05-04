import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Activity,
  ArrowUpDown,
  BarChart3,
  Clock3,
  Database,
  Eye,
  FileText,
  Filter,
  Link as LinkIcon,
  Lock,
  LogOut,
  MessageSquareText,
  RefreshCcw,
  Search,
  ShieldCheck,
  Signal,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UserRound,
  UsersRound,
} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import aligndLogo from '../assets/AligndLogo.png';

type ChartItem = {
  label: string;
  value: number;
};

type AdminSession = {
  username: string;
  sessionId: string;
  createdAt: string;
  expiresAt: string;
  csrfToken: string;
};

type AdminUser = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  analysesCount: number;
};

type AdminLog = {
  id: string;
  runId: string;
  message: string;
  createdAt: string;
};

type AdminAnalysisItem = {
  id: string;
  user: AdminUser;
  profileUrl: string;
  username: string;
  profileName: string;
  platform: string;
  profilePicUrl: string;
  biography: string;
  niche: string;
  followersCount: number | null;
  followsCount: number | null;
  postsCount: number | null;
  isVerified: boolean;
  isPrivate: boolean;
  compatibilityLabel: string;
  compatibilityScore: number | null;
  positioning: string;
  audienceSummary: string;
  trendsCount: number;
  ideasCount: number;
  hooksCount: number;
  recommendationsCount: number;
  sourcesCount: number;
  recentPostsCount: number;
  totalLikes: number;
  totalComments: number;
  totalViews: number;
  logsCount: number;
  createdAt: string;
  cacheKey: string;
};

type AdminAnalysisDetail = AdminAnalysisItem & {
  account: Record<string, unknown>;
  analysis: Record<string, unknown>;
  sources: Array<{title?: string; url?: string}>;
  logs: AdminLog[];
};

type AdminOverview = {
  generatedAt: string;
  realtimeAvailable: boolean;
  summary: {
    totalUsers: number;
    totalAnalyses: number;
    totalLogs: number;
    uniqueProfiles: number;
    analysesLast24h: number;
    analysesLast7d: number;
    averageCompatibility: number;
    totalSources: number;
    totalHooks: number;
    totalIdeas: number;
    totalTrends: number;
  };
  charts: {
    platforms: ChartItem[];
    scoreBuckets: ChartItem[];
    dailyAnalyses: ChartItem[];
    hourlyAnalyses: ChartItem[];
  };
  rankings: {
    topNiches: ChartItem[];
    rareNiches: ChartItem[];
    topProfiles: ChartItem[];
    rareProfiles: ChartItem[];
    topUsers: ChartItem[];
    topTrends: ChartItem[];
    rareTrends: ChartItem[];
    topHooks: ChartItem[];
    rareHooks: ChartItem[];
    topSources: ChartItem[];
    rareSources: ChartItem[];
  };
  users: AdminUser[];
  analyses: {
    items: AdminAnalysisItem[];
    total: number;
    limit: number;
    offset: number;
  };
};

type AdminFilters = {
  q: string;
  platform: string;
  niche: string;
  user: string;
  scoreMin: string;
  scoreMax: string;
  sort: string;
};

type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'disabled' | 'closed' | 'error';

const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:5000').replace(/\/$/, '');
const emptyFilters: AdminFilters = {
  q: '',
  platform: 'all',
  niche: '',
  user: '',
  scoreMin: '',
  scoreMax: '',
  sort: 'newest',
};

class AdminApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
  }
}

function extractErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }

  return typeof (payload as {error?: unknown}).error === 'string'
    ? (payload as {error: string}).error
    : fallback;
}

async function adminFetch<T>(path: string, csrfToken = '', options?: RequestInit): Promise<T> {
  const method = (options?.method || 'GET').toUpperCase();
  const needsCsrf = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options?.body ? {'Content-Type': 'application/json'} : {}),
      ...(needsCsrf && csrfToken ? {'X-CSRF-Token': csrfToken} : {}),
      ...options?.headers,
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AdminApiError(extractErrorMessage(payload, 'Admin request failed.'), response.status);
  }

  return payload as T;
}

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '-';
  }

  return new Intl.NumberFormat('ru-RU').format(value);
}

function formatCompact(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '-';
  }

  return new Intl.NumberFormat('ru-RU', {
    notation: 'compact',
    maximumFractionDigits: value > 9999 ? 1 : 0,
  }).format(value);
}

function formatDateTime(value: string) {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatShortDate(value: string) {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatHour(value: string) {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      hour: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function buildFilterParams(filters: AdminFilters) {
  const params = new URLSearchParams({limit: '100', sort: filters.sort});
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.platform !== 'all') params.set('platform', filters.platform);
  if (filters.niche.trim()) params.set('niche', filters.niche.trim());
  if (filters.user.trim()) params.set('user', filters.user.trim());
  if (filters.scoreMin.trim()) params.set('scoreMin', filters.scoreMin.trim());
  if (filters.scoreMax.trim()) params.set('scoreMax', filters.scoreMax.trim());
  return params;
}

function socketUrl() {
  const base = new URL(API_BASE_URL || '/', window.location.origin);
  const socketPath = `${base.pathname.replace(/\/$/, '')}/socket.io/`.replace(/^\/\//, '/');
  const url = new URL(socketPath, base.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('EIO', '4');
  url.searchParams.set('transport', 'websocket');
  return url.toString();
}

function connectAdminRealtime(
  onEvent: (eventName: string, payload: unknown) => void,
  onStatus: (status: RealtimeStatus) => void,
) {
  let closedByClient = false;
  const websocket = new WebSocket(socketUrl());
  onStatus('connecting');

  websocket.onmessage = (message) => {
    const data = String(message.data);
    if (data === '2') {
      websocket.send('3');
      return;
    }

    if (data.startsWith('0')) {
      websocket.send('40/adminpanel,{}');
      return;
    }

    if (data.startsWith('40/adminpanel')) {
      onStatus('connected');
      websocket.send('42/adminpanel,["admin:refresh"]');
      return;
    }

    if (data.startsWith('42/adminpanel,')) {
      const packet = JSON.parse(data.slice('42/adminpanel,'.length)) as [string, unknown];
      onEvent(packet[0], packet[1]);
    }
  };

  websocket.onerror = () => onStatus('error');
  websocket.onclose = () => {
    if (!closedByClient) {
      onStatus('closed');
    }
  };

  return {
    close: () => {
      closedByClient = true;
      websocket.close();
    },
  };
}

function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint: string;
  tone?: 'neutral' | 'green' | 'blue' | 'red';
}) {
  const toneClass =
    tone === 'green'
      ? 'border-emerald-400/25 bg-emerald-400/8 text-emerald-100'
      : tone === 'blue'
        ? 'border-cyan-400/25 bg-cyan-400/8 text-cyan-100'
        : tone === 'red'
          ? 'border-rose-400/25 bg-rose-400/8 text-rose-100'
          : 'border-white/10 bg-white/[0.04] text-white';

  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[13px] font-semibold text-white/65">{label}</div>
        <Icon size={18} className="shrink-0 text-white/65" />
      </div>
      <div className="mt-3 text-[26px] font-black leading-none tracking-[0] text-white">{value}</div>
      <div className="mt-2 text-[12px] leading-[1.35] text-white/50">{hint}</div>
    </div>
  );
}

function BarList({
  title,
  icon: Icon,
  items,
  empty = 'Нет данных',
}: {
  title: string;
  icon: LucideIcon;
  items: ChartItem[];
  empty?: string;
}) {
  const maxValue = Math.max(...items.map((item) => item.value), 0);

  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-lg border border-white/10 bg-[#10151B] p-4">
      <div className="mb-4 flex min-w-0 items-center gap-2 text-[15px] font-black text-white">
        <Icon size={18} className="shrink-0 text-cyan-200" />
        <span className="min-w-0 truncate">{title}</span>
      </div>
      <div className="space-y-3">
        {items.length === 0 ? (
          <div className="rounded-md border border-dashed border-white/10 px-3 py-5 text-center text-[13px] text-white/45">
            {empty}
          </div>
        ) : (
          items.map((item) => {
            const width = maxValue > 0 ? Math.max(5, Math.round((item.value / maxValue) * 100)) : 0;
            return (
              <div key={`${title}-${item.label}`} className="min-w-0">
                <div className="mb-1 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-[12px]">
                  <span className="min-w-0 truncate text-white/72" title={item.label}>
                    {item.label}
                  </span>
                  <span className="shrink-0 font-bold text-white">{formatNumber(item.value)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/8">
                  <div className="h-full rounded-full bg-cyan-300" style={{width: `${width}%`}} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function TimelineBars({title, items, hourly = false}: {title: string; items: ChartItem[]; hourly?: boolean}) {
  const maxValue = Math.max(...items.map((item) => item.value), 1);

  return (
    <section className="rounded-lg border border-white/10 bg-[#10151B] p-4">
      <div className="mb-4 flex items-center gap-2 text-[15px] font-black text-white">
        <Activity size={18} className="text-emerald-200" />
        {title}
      </div>
      <div className="flex h-[150px] items-end gap-1.5">
        {items.map((item) => {
          const height = Math.max(4, Math.round((item.value / maxValue) * 128));
          return (
            <div key={`${title}-${item.label}`} className="group flex min-w-0 flex-1 flex-col items-center gap-2">
              <div
                className="w-full rounded-t bg-emerald-300/85 transition-colors group-hover:bg-emerald-200"
                style={{height}}
                title={`${item.label}: ${item.value}`}
              />
              <div className="w-full truncate text-center text-[10px] text-white/42">
                {hourly ? formatHour(item.label) : formatShortDate(item.label)}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function JsonBlock({value}: {value: unknown}) {
  return (
    <pre className="max-h-[360px] overflow-auto rounded-md border border-white/10 bg-black/35 p-3 text-[12px] leading-[1.45] text-white/68">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function DetailPanel({
  detail,
  loading,
  logMessage,
  onLogMessageChange,
  onAddLog,
}: {
  detail: AdminAnalysisDetail | null;
  loading: boolean;
  logMessage: string;
  onLogMessageChange: (message: string) => void;
  onAddLog: () => void;
}) {
  if (loading) {
    return (
      <aside className="rounded-lg border border-white/10 bg-[#10151B] p-5 text-white/60">
        Загружаю полный анализ...
      </aside>
    );
  }

  if (!detail) {
    return (
      <aside className="rounded-lg border border-white/10 bg-[#10151B] p-5 text-white/60">
        Выберите анализ в таблице, чтобы открыть полный профиль, ответ AI, источники и журнал.
      </aside>
    );
  }

  const trends = Array.isArray((detail.analysis as {trends?: unknown}).trends)
    ? ((detail.analysis as {trends: Array<Record<string, unknown>>}).trends)
    : [];
  const hooks = Array.isArray((detail.analysis as {hooks?: unknown}).hooks)
    ? ((detail.analysis as {hooks: string[]}).hooks)
    : [];
  const ideas = Array.isArray((detail.analysis as {ideas?: unknown}).ideas)
    ? ((detail.analysis as {ideas: Array<Record<string, unknown>>}).ideas)
    : [];

  return (
    <aside className="rounded-lg border border-white/10 bg-[#10151B] p-5">
      <div className="flex flex-col gap-4 border-b border-white/10 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-[12px] font-bold uppercase text-white/42">Полный анализ</div>
          <h2 className="mt-1 break-words text-[22px] font-black tracking-[0] text-white">@{detail.username || 'unknown'}</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-[12px] text-white/55">
            <span>{detail.platform}</span>
            <span>{detail.niche || 'Без ниши'}</span>
            <span>{formatDateTime(detail.createdAt)}</span>
          </div>
        </div>
        <a
          href={detail.profileUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-white/12 px-3 text-[13px] font-semibold text-white/75 transition-colors hover:bg-white/8"
        >
          <LinkIcon size={15} />
          Профиль
        </a>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['Score', detail.compatibilityScore === null ? '-' : `${detail.compatibilityScore}%`],
          ['Followers', formatCompact(detail.followersCount)],
          ['Sources', detail.sourcesCount],
          ['Logs', detail.logs.length],
        ].map(([label, value]) => (
          <div key={label} className="rounded-md border border-white/10 bg-black/18 p-3">
            <div className="text-[11px] uppercase text-white/42">{label}</div>
            <div className="mt-1 text-[18px] font-black text-white">{value}</div>
          </div>
        ))}
      </div>

      <div className="mt-5 space-y-5">
        <section>
          <h3 className="mb-2 text-[14px] font-black text-white">Пользователь</h3>
          <div className="rounded-md border border-white/10 bg-black/18 p-3 text-[13px] leading-[1.5] text-white/68">
            <div>{detail.user.displayName}</div>
            <div>{detail.user.email}</div>
            <div>ID: {detail.user.id}</div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-[14px] font-black text-white">Тренды</h3>
          <div className="space-y-2">
            {trends.map((trend, index) => (
              <div key={`${detail.id}-trend-${index}`} className="rounded-md border border-white/10 bg-black/18 p-3">
                <div className="text-[13px] font-bold text-white">{String(trend.title || `Тренд ${index + 1}`)}</div>
                <div className="mt-1 text-[12px] leading-[1.45] text-white/55">{String(trend.description || '')}</div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-[14px] font-black text-white">Идеи и хуки</h3>
          <div className="grid gap-2 md:grid-cols-2">
            {ideas.map((idea, index) => (
              <div key={`${detail.id}-idea-${index}`} className="rounded-md border border-white/10 bg-black/18 p-3">
                <div className="text-[12px] font-bold text-cyan-100">{String(idea.tag || 'IDEA')}</div>
                <div className="mt-1 text-[13px] font-semibold text-white">{String(idea.title || '')}</div>
                <div className="mt-1 text-[12px] text-white/55">{String(idea.hook || '')}</div>
              </div>
            ))}
          </div>
          {hooks.length > 0 && (
            <div className="mt-2 rounded-md border border-white/10 bg-black/18 p-3 text-[12px] leading-[1.5] text-white/60">
              {hooks.map((hook, index) => (
                <div key={`${detail.id}-hook-${index}`}>
                  {index + 1}. {hook}
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-[14px] font-black text-white">Источники</h3>
          <div className="space-y-2">
            {detail.sources.length === 0 ? (
              <div className="text-[13px] text-white/45">Источников нет.</div>
            ) : (
              detail.sources.map((source, index) => (
                <a
                  key={`${detail.id}-source-${index}`}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-md border border-white/10 bg-black/18 p-3 text-[12px] text-white/65 transition-colors hover:bg-white/8"
                >
                  <div className="font-bold text-white">{source.title || source.url}</div>
                  <div className="mt-1 break-all text-white/45">{source.url}</div>
                </a>
              ))
            )}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-[14px] font-black text-white">Журнал анализа</h3>
          <div className="space-y-2">
            {detail.logs.length === 0 ? (
              <div className="rounded-md border border-dashed border-white/10 p-3 text-[13px] text-white/45">
                Заметок пока нет.
              </div>
            ) : (
              detail.logs.map((log) => (
                <div key={log.id} className="rounded-md border border-white/10 bg-black/18 p-3">
                  <div className="text-[12px] text-white/42">{formatDateTime(log.createdAt)}</div>
                  <div className="mt-1 whitespace-pre-wrap text-[13px] leading-[1.45] text-white/70">{log.message}</div>
                </div>
              ))
            )}
          </div>
          <textarea
            value={logMessage}
            onChange={(event) => onLogMessageChange(event.target.value)}
            placeholder="Добавить админскую заметку к этому анализу"
            className="mt-3 min-h-[92px] w-full resize-y rounded-md border border-white/10 bg-black/28 px-3 py-2 text-[13px] text-white outline-none placeholder:text-white/35 focus:border-cyan-300/60"
          />
          <button
            type="button"
            onClick={onAddLog}
            disabled={!logMessage.trim()}
            className="mt-2 inline-flex h-9 items-center justify-center gap-2 rounded-md bg-cyan-200 px-3 text-[13px] font-black text-black transition-colors hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <MessageSquareText size={15} />
            Записать
          </button>
        </section>

        <section>
          <h3 className="mb-2 text-[14px] font-black text-white">Raw JSON</h3>
          <div className="space-y-3">
            <JsonBlock value={{account: detail.account, analysis: detail.analysis, sources: detail.sources}} />
          </div>
        </section>
      </div>
    </aside>
  );
}

export default function AdminPanel() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [csrfToken, setCsrfToken] = useState('');
  const [username, setUsername] = useState('Lekim');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [analyses, setAnalyses] = useState<AdminAnalysisItem[]>([]);
  const [selectedDetail, setSelectedDetail] = useState<AdminAnalysisDetail | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [filters, setFilters] = useState<AdminFilters>(emptyFilters);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('idle');
  const [realtimeNonce, setRealtimeNonce] = useState(0);
  const [notice, setNotice] = useState('');
  const [logMessage, setLogMessage] = useState('');
  const filtersRef = useRef(filters);
  const csrfTokenRef = useRef(csrfToken);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    csrfTokenRef.current = csrfToken;
  }, [csrfToken]);

  const loadDashboard = useCallback(
    async (nextFilters: AdminFilters = filtersRef.current, csrf: string = csrfTokenRef.current) => {
      setDashboardLoading(true);
      try {
        const params = buildFilterParams(nextFilters);
        const payload = await adminFetch<AdminOverview>(`/admin/overview?${params.toString()}`, csrf);
        setOverview(payload);
        setAnalyses(payload.analyses.items);
        setNotice(`Обновлено: ${formatDateTime(payload.generatedAt)}`);
        if (selectedId && !payload.analyses.items.some((item) => item.id === selectedId)) {
          setSelectedDetail(null);
          setSelectedId('');
        }
      } catch (error) {
        if (error instanceof AdminApiError && error.status === 401) {
          setCsrfToken('');
          setSession(null);
        } else {
          setNotice(error instanceof Error ? error.message : 'Не удалось загрузить админку.');
        }
      } finally {
        setDashboardLoading(false);
      }
    },
    [selectedId],
  );

  const openDetail = useCallback(
    async (analysisId: string, csrf: string = csrfTokenRef.current) => {
      if (!analysisId) {
        return;
      }

      setSelectedId(analysisId);
      setDetailLoading(true);
      setLogMessage('');
      try {
        const detail = await adminFetch<AdminAnalysisDetail>(`/admin/analyses/${analysisId}`, csrf);
        setSelectedDetail(detail);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'Не удалось открыть анализ.');
      } finally {
        setDetailLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    adminFetch<{admin: AdminSession}>('/admin/auth/me')
      .then((payload) => {
        setSession(payload.admin);
        csrfTokenRef.current = payload.admin.csrfToken;
        setCsrfToken(payload.admin.csrfToken);
        return loadDashboard(emptyFilters, payload.admin.csrfToken);
      })
      .catch(() => {
        setCsrfToken('');
        setSession(null);
      })
      .finally(() => setLoading(false));
  }, [loadDashboard]);

  useEffect(() => {
    if (!session) {
      setRealtimeStatus('idle');
      return;
    }

    if (overview && !overview.realtimeAvailable) {
      setRealtimeStatus('disabled');
      return;
    }

    let reconnectTimer = window.setTimeout(() => undefined, 0);
    window.clearTimeout(reconnectTimer);
    const connection = connectAdminRealtime(
      (eventName) => {
        if (eventName === 'admin:snapshot' || eventName === 'admin:analysis_created' || eventName === 'admin:analysis_logged' || eventName === 'admin:analyses_deleted') {
          setNotice('Получено live-обновление.');
          void loadDashboard(filtersRef.current, csrfTokenRef.current);
          if (selectedId) {
            void openDetail(selectedId, csrfTokenRef.current);
          }
        }
      },
      (status) => {
        setRealtimeStatus(status);
        if (status === 'closed' || status === 'error') {
          reconnectTimer = window.setTimeout(() => {
            setRealtimeNonce((value) => value + 1);
          }, 2500);
        }
      },
    );

    return () => {
      window.clearTimeout(reconnectTimer);
      connection.close();
    };
  }, [loadDashboard, openDetail, overview?.realtimeAvailable, realtimeNonce, selectedId, session]);

  useEffect(() => {
    if (!selectedDetail && analyses.length > 0) {
      void openDetail(analyses[0].id);
    }
  }, [analyses, openDetail, selectedDetail]);

  const platforms = useMemo(() => {
    const values = new Set(overview?.charts.platforms.map((item) => item.label).filter(Boolean) || []);
    return ['all', ...Array.from(values)];
  }, [overview?.charts.platforms]);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoginError('');
    setLoginLoading(true);

    try {
      const payload = await adminFetch<{admin: AdminSession}>('/admin/auth/login', '', {
        method: 'POST',
        body: JSON.stringify({username, password}),
      });
      csrfTokenRef.current = payload.admin.csrfToken;
      setCsrfToken(payload.admin.csrfToken);
      setSession(payload.admin);
      setPassword('');
      await loadDashboard(emptyFilters, payload.admin.csrfToken);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Не удалось войти в админку.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await adminFetch<{status: string}>('/admin/auth/logout', csrfToken, {method: 'POST'});
    } catch {
      // Client cleanup is enough if the server session already expired.
    }

    setCsrfToken('');
    setSession(null);
    setOverview(null);
    setAnalyses([]);
    setSelectedDetail(null);
    setRealtimeStatus('idle');
  };

  const handleFiltersSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void loadDashboard(filters);
  };

  const handleAddLog = async () => {
    if (!selectedDetail || !logMessage.trim()) {
      return;
    }

    try {
      await adminFetch<{log: AdminLog}>(`/admin/analyses/${selectedDetail.id}/logs`, csrfToken, {
        method: 'POST',
        body: JSON.stringify({message: logMessage.trim()}),
      });
      setLogMessage('');
      await openDetail(selectedDetail.id);
      await loadDashboard(filters);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Не удалось записать лог.');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#090D12] text-white">
        <div className="flex items-center gap-3 text-[15px] text-white/65">
          <RefreshCcw size={18} className="animate-spin" />
          Проверяю админскую сессию
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-[#090D12] px-4 py-8 text-white">
        <div className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-[420px] flex-col justify-center">
          <div className="mb-7 flex items-center gap-3">
            <img src={aligndLogo} alt="Alignd" className="h-11 w-auto" />
            <div>
              <div className="text-[24px] font-black tracking-[0]">Alignd Admin</div>
              <div className="text-[13px] text-white/45">Отдельное окно управления</div>
            </div>
          </div>

          <form onSubmit={handleLogin} className="rounded-lg border border-white/10 bg-[#10151B] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
            <div className="mb-5 flex items-center gap-2 text-[14px] font-bold text-cyan-100">
              <Lock size={17} />
              Вход в /adminpanel
            </div>
            <label className="block text-[12px] font-bold uppercase text-white/45">Логин</label>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-2 h-11 w-full rounded-md border border-white/10 bg-black/28 px-3 text-[15px] text-white outline-none focus:border-cyan-300/60"
              autoComplete="username"
            />
            <label className="mt-4 block text-[12px] font-bold uppercase text-white/45">Пароль</label>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 h-11 w-full rounded-md border border-white/10 bg-black/28 px-3 text-[15px] text-white outline-none focus:border-cyan-300/60"
              type="password"
              autoComplete="current-password"
            />
            <button
              type="submit"
              disabled={loginLoading}
              className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-cyan-200 px-4 text-[15px] font-black text-black transition-colors hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-55"
            >
              <ShieldCheck size={18} />
              {loginLoading ? 'Входим...' : 'Войти'}
            </button>
            {loginError && <div className="mt-4 rounded-md border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-[13px] text-rose-100">{loginError}</div>}
          </form>
        </div>
      </div>
    );
  }

  const summary = overview?.summary;

  return (
    <div className="min-h-screen bg-[#090D12] text-white">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#090D12]/92 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-4 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <img src={aligndLogo} alt="Alignd" className="h-10 w-auto shrink-0" />
            <div className="min-w-0">
              <h1 className="truncate text-[22px] font-black tracking-[0]">Admin Panel</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-white/48">
                <span>/adminpanel</span>
                <span>{session.username}</span>
                <span className="inline-flex items-center gap-1">
                  <Signal size={13} />
                  {realtimeStatus === 'connected'
                    ? 'Socket.IO live'
                    : realtimeStatus === 'disabled'
                      ? 'Socket.IO не установлен'
                      : realtimeStatus}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadDashboard(filters)}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/12 px-3 text-[13px] font-bold text-white/75 transition-colors hover:bg-white/8"
            >
              <RefreshCcw size={16} className={dashboardLoading ? 'animate-spin' : ''} />
              Обновить
            </button>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/12 px-3 text-[13px] font-bold text-white/75 transition-colors hover:bg-white/8"
            >
              <LogOut size={16} />
              Выйти
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1480px] px-4 py-5 lg:px-6">
        <form onSubmit={handleFiltersSubmit} className="mb-5 rounded-lg border border-white/10 bg-[#10151B] p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(220px,1.4fr)_160px_minmax(140px,0.8fr)_minmax(140px,0.8fr)_110px_110px_160px_auto]">
            <label className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
              <input
                value={filters.q}
                onChange={(event) => setFilters((value) => ({...value, q: event.target.value}))}
                placeholder="Поиск: профиль, пользователь, ниша, текст анализа"
                className="h-10 w-full rounded-md border border-white/10 bg-black/24 pl-9 pr-3 text-[13px] text-white outline-none placeholder:text-white/35 focus:border-cyan-300/60"
              />
            </label>
            <select
              value={filters.platform}
              onChange={(event) => setFilters((value) => ({...value, platform: event.target.value}))}
              className="h-10 rounded-md border border-white/10 bg-black/24 px-3 text-[13px] text-white outline-none focus:border-cyan-300/60"
            >
              {platforms.map((platform) => (
                <option key={platform} value={platform}>
                  {platform === 'all' ? 'Все платформы' : platform}
                </option>
              ))}
            </select>
            <input
              value={filters.niche}
              onChange={(event) => setFilters((value) => ({...value, niche: event.target.value}))}
              placeholder="Ниша"
              className="h-10 rounded-md border border-white/10 bg-black/24 px-3 text-[13px] text-white outline-none placeholder:text-white/35 focus:border-cyan-300/60"
            />
            <input
              value={filters.user}
              onChange={(event) => setFilters((value) => ({...value, user: event.target.value}))}
              placeholder="Пользователь"
              className="h-10 rounded-md border border-white/10 bg-black/24 px-3 text-[13px] text-white outline-none placeholder:text-white/35 focus:border-cyan-300/60"
            />
            <input
              value={filters.scoreMin}
              onChange={(event) => setFilters((value) => ({...value, scoreMin: event.target.value}))}
              placeholder="Score от"
              className="h-10 rounded-md border border-white/10 bg-black/24 px-3 text-[13px] text-white outline-none placeholder:text-white/35 focus:border-cyan-300/60"
            />
            <input
              value={filters.scoreMax}
              onChange={(event) => setFilters((value) => ({...value, scoreMax: event.target.value}))}
              placeholder="Score до"
              className="h-10 rounded-md border border-white/10 bg-black/24 px-3 text-[13px] text-white outline-none placeholder:text-white/35 focus:border-cyan-300/60"
            />
            <select
              value={filters.sort}
              onChange={(event) => setFilters((value) => ({...value, sort: event.target.value}))}
              className="h-10 rounded-md border border-white/10 bg-black/24 px-3 text-[13px] text-white outline-none focus:border-cyan-300/60"
            >
              <option value="newest">Новые</option>
              <option value="score-high">Score выше</option>
              <option value="score-low">Score ниже</option>
              <option value="followers-high">Подписчики</option>
              <option value="username">Username</option>
            </select>
            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-white px-4 text-[13px] font-black text-black transition-colors hover:bg-cyan-100"
            >
              <Filter size={16} />
              Фильтр
            </button>
          </div>
        </form>

        {notice && <div className="mb-5 rounded-md border border-white/10 bg-white/[0.04] px-4 py-2 text-[13px] text-white/62">{notice}</div>}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <MetricCard icon={Database} label="Анализы" value={formatNumber(summary?.totalAnalyses)} hint="Все сохраненные разборы" tone="blue" />
          <MetricCard icon={UsersRound} label="Пользователи" value={formatNumber(summary?.totalUsers)} hint="Зарегистрированные аккаунты" />
          <MetricCard icon={Eye} label="Профили" value={formatNumber(summary?.uniqueProfiles)} hint="Уникальные ссылки" />
          <MetricCard icon={Clock3} label="24 часа" value={formatNumber(summary?.analysesLast24h)} hint="Новые анализы" tone="green" />
          <MetricCard icon={Sparkles} label="Avg score" value={`${formatNumber(summary?.averageCompatibility)}%`} hint="Средняя совместимость" />
          <MetricCard icon={MessageSquareText} label="Логи" value={formatNumber(summary?.totalLogs)} hint="Админские заметки" tone="red" />
        </section>

        <section className="mt-5 grid gap-4 xl:grid-cols-4">
          <TimelineBars title="Динамика за 14 дней" items={overview?.charts.dailyAnalyses || []} />
          <TimelineBars title="Активность за 24 часа" items={overview?.charts.hourlyAnalyses || []} hourly />
          <BarList title="Платформы" icon={BarChart3} items={overview?.charts.platforms || []} />
          <BarList title="Score buckets" icon={ArrowUpDown} items={overview?.charts.scoreBuckets || []} />
        </section>

        <section className="mt-5 grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          <BarList title="Частые ниши" icon={TrendingUp} items={overview?.rankings.topNiches || []} />
          <BarList title="Редкие ниши" icon={TrendingDown} items={overview?.rankings.rareNiches || []} />
          <BarList title="Частые профили" icon={UserRound} items={overview?.rankings.topProfiles || []} />
          <BarList title="Редкие профили" icon={UserRound} items={overview?.rankings.rareProfiles || []} />
          <BarList title="Пользователи по анализам" icon={UsersRound} items={overview?.rankings.topUsers || []} />
          <BarList title="Источники" icon={LinkIcon} items={overview?.rankings.topSources || []} />
          <BarList title="Редкие источники" icon={LinkIcon} items={overview?.rankings.rareSources || []} />
          <BarList
            title="Контент-суммы"
            icon={FileText}
            items={[
              {label: 'Тренды', value: summary?.totalTrends || 0},
              {label: 'Идеи', value: summary?.totalIdeas || 0},
              {label: 'Хуки', value: summary?.totalHooks || 0},
              {label: 'Источники', value: summary?.totalSources || 0},
              {label: '7 дней', value: summary?.analysesLast7d || 0},
            ]}
          />
        </section>

        <section className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(420px,0.9fr)]">
          <div className="rounded-lg border border-white/10 bg-[#10151B]">
            <div className="flex flex-col gap-2 border-b border-white/10 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-[17px] font-black text-white">Все анализы</h2>
                <div className="mt-1 text-[12px] text-white/45">
                  Показано {formatNumber(analyses.length)} из {formatNumber(overview?.analyses.total || 0)}
                </div>
              </div>
              {dashboardLoading && <div className="text-[12px] text-white/45">Обновляю данные...</div>}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] border-collapse text-left text-[13px]">
                <thead className="text-[11px] uppercase text-white/42">
                  <tr className="border-b border-white/10">
                    <th className="px-4 py-3 font-bold">Профиль</th>
                    <th className="px-4 py-3 font-bold">Пользователь</th>
                    <th className="px-4 py-3 font-bold">Ниша</th>
                    <th className="px-4 py-3 font-bold">Score</th>
                    <th className="px-4 py-3 font-bold">Инфо</th>
                    <th className="px-4 py-3 font-bold">Дата</th>
                  </tr>
                </thead>
                <tbody>
                  {analyses.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => void openDetail(item.id)}
                      className={`cursor-pointer border-b border-white/6 transition-colors hover:bg-white/[0.04] ${
                        selectedId === item.id ? 'bg-cyan-300/8' : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-bold text-white">@{item.username || 'unknown'}</div>
                        <div className="mt-1 text-[12px] text-white/42">{item.platform}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-white/72">{item.user.displayName}</div>
                        <div className="mt-1 text-[12px] text-white/38">{item.user.email}</div>
                      </td>
                      <td className="max-w-[260px] px-4 py-3">
                        <div className="truncate text-white/72" title={item.niche}>{item.niche || 'Без ниши'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-black text-white">{item.compatibilityScore === null ? '-' : `${item.compatibilityScore}%`}</div>
                        <div className="mt-1 text-[12px] text-white/42">{item.compatibilityLabel}</div>
                      </td>
                      <td className="px-4 py-3 text-white/62">
                        <div>{item.trendsCount} тренда · {item.ideasCount} идеи · {item.hooksCount} хуков</div>
                        <div className="mt-1 text-[12px] text-white/38">{item.sourcesCount} источн. · {item.logsCount} логов</div>
                      </td>
                      <td className="px-4 py-3 text-white/55">{formatDateTime(item.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {analyses.length === 0 && (
                <div className="px-4 py-10 text-center text-[14px] text-white/45">По этим фильтрам анализов нет.</div>
              )}
            </div>
          </div>

          <DetailPanel
            detail={selectedDetail}
            loading={detailLoading}
            logMessage={logMessage}
            onLogMessageChange={setLogMessage}
            onAddLog={() => void handleAddLog()}
          />
        </section>
      </main>
    </div>
  );
}
