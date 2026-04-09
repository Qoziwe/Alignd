import React, { useState } from 'react';
import { ArrowLeft, Flame, TrendingUp, Lightbulb, Zap, Heart } from 'lucide-react';
import heroLiquid from '../assets/image.png';

type Step = 'home' | 'loading' | 'results';

const MOCK_TRENDS = [
  {
    id: 1,
    type: 'top',
    title: 'День из жизни предпринимателя',
    description: 'Реалистичные POV-видео о буднях бизнеса набирают до 2M просмотров',
    match: 97,
  },
  {
    id: 2,
    type: 'top',
    title: 'Цифры вслух',
    description: 'Откровенные посты с реальной выручкой, расходами и провалами',
    match: 92,
  },
  {
    id: 3,
    type: 'growing',
    title: 'Путь с нуля до X',
    description: 'Формат мини-сериала: старт, ошибки, первые продажи',
    match: 85,
  },
  {
    id: 4,
    type: 'growing',
    title: 'Разбор ошибок',
    description: 'Почему моя идея не сработала — честный разбор без прикрас',
    match: 80,
  }
];

const MOCK_IDEAS = [
  {
    id: 1,
    tag: 'POV',
    title: 'POV: первый год в бизнесе — честно о деньгах',
    hook: 'Я думал, что открою бизнес и буду работать 2 часа в день на Бали. Вот как выглядит моя реальность...',
  },
  {
    id: 2,
    tag: 'ОБРАЗОВАНИЕ',
    title: '3 ошибки, которые убивают конверсию',
    hook: 'Если ваш сайт не продает, проверьте эти три вещи. Спойлер: дело не в дизайне.',
  }
];

const MOCK_HOOKS = [
  { id: '01', text: 'POV: первый год в бизнесе — честно о деньгах' },
  { id: '02', text: 'Я заработал [X] за месяц. Вот что я сделал иначе' },
  { id: '03', text: 'Не открывайте бизнес, пока не посмотрите это' },
  { id: '04', text: 'Мне стыдно это признавать, но именно это спасло мой бизнес' },
  { id: '05', text: 'Не открывайте бизнес, пока не посмотрите это' },
  { id: '06', text: 'Не открывайте бизнес, пока не посмотрите это' },
];

const AI_RECOMMENDATIONS = [
  'Чтобы ваш аккаунт в социальных сетях приносил больше клиентов и вызывал доверие, важно системно подойти к его оформлению и ведению:',
  '1. Чёткое позиционирование',
  'Определите, чем вы отличаетесь от конкурентов. Уникальное торговое предложение должно быть понятно уже с первых секунд просмотра профиля.',
  '2. Оформление профиля',
  '• Аватар — качественный и узнаваемый (логотип или лицо бренда)',
  '• Описание — кратко и по делу: чем вы полезны + призыв к действию',
  '• Актуальные сторис — структурированы и полезны (отзывы, услуги, кейсы)',
  '3. Контент-стратегия',
  'Соблюдайте баланс:',
  '• экспертный контент (польза)',
  '• продающий контент',
  '• личный контент для доверия',
];

export default function App() {
  const [step, setStep] = useState<Step>('home');
  const [url, setUrl] = useState('');
  const [niche, setNiche] = useState('');
  const [isAdviceExpanded, setIsAdviceExpanded] = useState(false);
  const isResults = step === 'results';
  const primaryIdea = MOCK_IDEAS[0];

  const handleAnalyze = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;
    setStep('loading');
    setTimeout(() => {
      setStep('results');
    }, 2000);
  };

  const extractUsername = (inputUrl: string) => {
    try {
      if (inputUrl.includes('@')) {
        return inputUrl.split('@')[1].split(/[/?]/)[0];
      }
      const parts = inputUrl.split('/');
      return parts[parts.length - 1] || parts[parts.length - 2] || 'username';
    } catch {
      return 'username';
    }
  };

  return (
    <div className="min-h-screen bg-[#050507] text-white font-sans selection:bg-white/20 relative overflow-hidden flex flex-col">
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        {isResults ? (
          <>
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(57,48,85,0.22),transparent_26%),radial-gradient(circle_at_18%_24%,rgba(77,101,138,0.12),transparent_24%),radial-gradient(circle_at_78%_42%,rgba(72,84,108,0.12),transparent_20%),linear-gradient(180deg,#06060A_0%,#050507_52%,#040406_100%)]" />
            <div className="absolute left-[-10%] top-[10%] h-[340px] w-[340px] rounded-full bg-[rgba(112,128,186,0.07)] blur-[120px]" />
            <div className="absolute right-[-8%] top-[30%] h-[280px] w-[280px] rounded-full bg-[rgba(121,112,162,0.07)] blur-[120px]" />
            <div className="absolute left-[40%] top-[38%] h-[220px] w-[220px] rounded-full bg-[rgba(255,255,255,0.03)] blur-[95px]" />
          </>
        ) : (
          <>
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(66,71,111,0.32),transparent_34%),radial-gradient(circle_at_14%_18%,rgba(100,115,174,0.16),transparent_20%),radial-gradient(circle_at_84%_14%,rgba(122,96,164,0.16),transparent_20%),linear-gradient(180deg,#11131d_0%,#08090f_28%,#050507_62%,#040406_100%)]" />
            <div className="absolute left-[-8%] top-[7%] h-[380px] w-[380px] rounded-full bg-[rgba(124,142,255,0.08)] blur-[120px]" />
            <div className="absolute right-[-10%] top-[-2%] h-[340px] w-[340px] rounded-full bg-[rgba(170,154,255,0.08)] blur-[140px]" />
            <div className="absolute left-[36%] top-[2%] h-[210px] w-[210px] rounded-full bg-[rgba(255,255,255,0.06)] blur-[90px]" />
            <div className="absolute left-[7%] top-[13%] h-[1px] w-[86%] bg-gradient-to-r from-transparent via-white/12 to-transparent" />
            <div className="absolute left-[54%] top-[12%] h-12 w-12 rounded-full bg-gradient-to-b from-[#696f7e] to-[#272c38] opacity-80 shadow-[0_10px_40px_rgba(0,0,0,0.4)]" />
            <div className="absolute right-[7%] top-[6.5%] h-7 w-7 rounded-full bg-gradient-to-b from-[#7a7f8f] to-[#2a2f38] opacity-85 shadow-[0_10px_35px_rgba(0,0,0,0.45)]" />
            <div className="absolute right-[31%] top-[42%] h-8 w-8 rounded-full bg-gradient-to-b from-[#646b77] to-[#262b34] opacity-80 shadow-[0_10px_35px_rgba(0,0,0,0.4)] sm:h-14 sm:w-14" />
          </>
        )}
      </div>

      <header className="relative z-10 flex items-center justify-between px-6 md:px-12 pt-6 pb-4 max-w-[1280px] mx-auto w-full">
        {isResults ? (
          <>
            <div className="hidden md:block w-1/3"></div>
            <div className="w-full md:w-1/3 text-center text-[28px] font-black tracking-[-0.05em] uppercase">
              ALIGND
            </div>
            <div className="hidden md:block w-1/3"></div>
          </>
        ) : (
          <>
            <div className="w-1/3 hidden md:block"></div>
            <div className="w-full md:w-1/3 text-left md:text-center text-[28px] font-black tracking-[-0.05em] uppercase">
              ALIGND
            </div>
            <div className="w-auto md:w-1/3 flex justify-end items-center gap-5">
              <button className="text-[15px] font-semibold text-gray-200 hover:text-white transition-colors hidden sm:block">
                Войти
              </button>
              <button className="text-[15px] bg-[#ECECEC] text-black px-6 py-3 rounded-lg font-bold hover:bg-white transition-colors shadow-[0_10px_30px_rgba(255,255,255,0.08)]">
                Начать бесплатно
              </button>
            </div>
          </>
        )}
      </header>

      <main className="relative z-10 flex-1 w-full max-w-[1280px] mx-auto px-6 md:px-12 pb-20">
        {step === 'home' && (
          <div className="flex flex-col animate-in fade-in duration-500">
            <section className="relative mt-[18px] mb-[176px] lg:mt-[26px] lg:mb-[224px]">
              <div className="grid items-start gap-3 lg:grid-cols-[790px_minmax(0,1fr)]">
                <div className="max-w-[830px] pt-4 sm:pt-6 lg:w-[790px] lg:max-w-none lg:pt-[80px] lg:-translate-x-[100px]">
                  <div className="mb-10 inline-flex items-center gap-3 rounded-full border border-white/18 bg-white/[0.03] px-6 py-2.5 text-[17px] font-medium text-gray-300 backdrop-blur-md shadow-[0_12px_40px_rgba(0,0,0,0.25)]">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(74,222,128,0.95)]"></span>
                    AI-генератор контента · Новинка
                  </div>

                  <h1 className="max-w-[790px] text-[62px] font-bold leading-[0.95] tracking-[-0.055em] text-white sm:text-[68px] lg:max-w-none lg:text-[84px]">
                    Создавай контент,
                    <br />
                    который залетает
                  </h1>

                  <p className="mt-7 max-w-[760px] text-[22px] leading-[1.28] text-gray-300 sm:text-[23px] lg:max-w-none">
                    Вставь ссылку на свой TikTok или Instagram — ИИ проанализирует твою нишу и выдаст идеи, хуки и сценарии на основе актуальных трендов
                  </p>

                  <button className="mt-11 inline-flex rounded-[18px] bg-[#ECECEC] px-11 py-[21px] text-[20px] font-bold text-black transition-colors hover:bg-white shadow-[0_18px_60px_rgba(255,255,255,0.08)]">
                    Попробовать бесплатно
                  </button>
                </div>

                <div className="relative flex min-h-[320px] items-start justify-end overflow-visible pt-6 lg:min-h-[560px] lg:pt-[30px]">
                  <div className="absolute left-[10%] top-[18%] h-24 w-24 rounded-full bg-[rgba(255,255,255,0.04)] blur-3xl" />
                  <img
                    src={heroLiquid}
                    alt="Abstract glossy liquid shape"
                    className="relative z-10 w-full max-w-[560px] object-contain drop-shadow-[0_30px_90px_rgba(0,0,0,0.65)] sm:max-w-[620px] lg:w-[1540px] lg:max-w-none lg:translate-x-[80%] lg:-translate-y-[-10%] lg:scale-[1.3]"
                  />
                </div>
              </div>
            </section>

            <div className="w-full rounded-[18px] border border-white/10 bg-[rgba(20,20,26,0.88)] px-12 py-11 shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur-md sm:px-13 sm:py-12">
              <form onSubmit={handleAnalyze} className="space-y-8">
                <div>
                  <label className="mb-5 block text-[20px] font-bold text-white sm:text-[22px]">Ссылка на профиль</label>
                  <div className="flex flex-col gap-4 md:flex-row md:items-center">
                    <input
                      type="text"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://tiktok.com/@username или instagram.co"
                      className="h-[64px] flex-1 rounded-xl border border-white/12 bg-[rgba(255,255,255,0.06)] px-6 text-[19px] text-gray-200 placeholder:text-gray-500 focus:border-white/28 focus:outline-none focus:ring-0"
                      required
                    />
                    <button
                      type="submit"
                      className="h-[64px] rounded-xl bg-[#ECECEC] px-10 text-[20px] font-bold text-black transition-colors hover:bg-white md:min-w-[270px]"
                    >
                      Анализировать
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-5 block text-[20px] font-bold text-white sm:text-[22px]">Опишите свою нишу</label>
                  <input
                    type="text"
                    value={niche}
                    onChange={(e) => setNiche(e.target.value)}
                    className="h-[64px] w-full rounded-xl border border-white/12 bg-[rgba(255,255,255,0.06)] px-6 text-[19px] text-gray-200 placeholder:text-gray-500 focus:border-white/28 focus:outline-none focus:ring-0"
                  />
                </div>
              </form>
            </div>
          </div>
        )}

        {step === 'loading' && (
          <div className="flex flex-col items-center justify-center py-32 animate-in fade-in duration-500">
            <div className="w-16 h-16 border-4 border-gray-800 border-t-gray-200 rounded-full animate-spin mb-8"></div>
            <h2 className="text-2xl font-semibold mb-2">Анализируем профиль...</h2>
            <p className="text-gray-400">Ищем актуальные тренды и генерируем идеи</p>
          </div>
        )}

        {step === 'results' && (
          <div className="mx-auto mt-[22px] w-full max-w-[1128px] animate-in fade-in slide-in-from-bottom-8 duration-700 pb-28">
            <div className="flex flex-col items-start gap-4">
              <button
                onClick={() => setStep('home')}
                className="inline-flex h-[58px] items-center gap-3 rounded-xl border border-white/24 bg-[rgba(19,19,24,0.72)] px-7 text-[18px] font-medium text-gray-100 transition-colors hover:bg-[rgba(27,27,34,0.9)]"
              >
                <ArrowLeft size={20} />
                Назад
              </button>

              <div className="flex min-h-[58px] items-center gap-3 rounded-full border border-white/24 bg-[rgba(28,28,34,0.78)] px-5 text-[16px] font-medium text-gray-200 shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
                <span className="h-2 w-2 rounded-full bg-[#4FD5B2] shadow-[0_0_10px_rgba(79,213,178,0.9)]"></span>
                ИИ сгенерировал персонализированные рекомендации
              </div>
            </div>

            <section className="mt-[72px] rounded-[18px] border border-white/12 bg-[#15151A] px-10 py-11 shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
              <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex flex-col gap-8 sm:flex-row sm:items-start">
                  <div className="h-[146px] w-[146px] rounded-full bg-[#D9D9D9] shrink-0"></div>
                  <div className="pt-1">
                    <h2 className="text-[28px] font-black uppercase tracking-[-0.04em] text-white">@{extractUsername(url).toUpperCase()}</h2>
                    <p className="mt-3 text-[18px] leading-none text-gray-300">
                      Ниша: {niche || 'Бизнес / МСБ'} · Персонализировано
                    </p>

                    <div className="mt-16 grid grid-cols-1 gap-8 sm:grid-cols-3 sm:gap-12">
                      <div>
                        <div className="text-[28px] font-black tracking-[-0.04em] text-white">---</div>
                        <div className="mt-4 text-[16px] text-gray-300">Подписчики</div>
                      </div>
                      <div>
                        <div className="text-[28px] font-black tracking-[-0.04em] text-white">{niche || 'Бизнес'}</div>
                        <div className="mt-4 text-[16px] text-gray-300">Ниша</div>
                      </div>
                      <div>
                        <div className="text-[28px] font-black tracking-[-0.04em] text-white">Высокая</div>
                        <div className="mt-4 text-[16px] text-gray-300">Совместимость</div>
                      </div>
                    </div>
                  </div>
                </div>

                <button className="inline-flex h-[54px] min-w-[176px] items-center justify-center rounded-[16px] border border-white/24 bg-[rgba(39,39,46,0.7)] px-8 text-[18px] font-bold text-white transition-colors hover:bg-[rgba(53,53,61,0.9)]">
                  TikTok
                </button>
              </div>
            </section>

            <section className="mt-[64px]">
              <h3 className="mb-8 flex items-center gap-4 text-[28px] font-black uppercase tracking-[-0.045em] text-white">
                <Flame size={28} className="text-white" />
                Актуальные тренды для вашей ниши
              </h3>

              <div className="grid grid-cols-1 gap-[18px] md:grid-cols-2">
                {MOCK_TRENDS.map((trend) => (
                  <article
                    key={trend.id}
                    className="flex min-h-[286px] flex-col rounded-[18px] border border-white/12 bg-[#15151A] px-10 py-10 shadow-[0_20px_60px_rgba(0,0,0,0.16)]"
                  >
                    <div className={`inline-flex h-[38px] w-fit items-center gap-2 rounded-[14px] px-4 text-[13px] font-black uppercase tracking-[-0.01em] ${trend.type === 'top' ? 'bg-[#5B2730] text-[#FF4C64]' : 'bg-[#1E4D37] text-[#4CC287]'}`}>
                      {trend.type === 'top' ? <Flame size={16} strokeWidth={2.4} /> : <TrendingUp size={16} strokeWidth={2.4} />}
                      {trend.type === 'top' ? 'ТОП' : 'РАСТЕТ'}
                    </div>

                    <div className="mt-[34px]">
                      <h4 className="text-[20px] font-bold leading-[1.2] text-white">{trend.title}</h4>
                      <p className="mt-4 max-w-[400px] text-[17px] leading-[1.3] text-gray-200">{trend.description}</p>
                    </div>

                    <div className="mt-auto pt-9">
                      <div className="mb-3 text-[14px] font-medium text-[#49CFAF]">{trend.match}% совпадение</div>
                      <div className="h-[3px] w-full rounded-full bg-white/18">
                        <div className="h-[3px] rounded-full bg-[#49CFAF]" style={{ width: `${trend.match}%` }}></div>
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
              </article>
            </section>

            <section className="mt-[68px]">
              <h3 className="mb-8 flex items-center gap-4 text-[28px] font-black uppercase tracking-[-0.045em] text-white">
                <Zap size={26} className="text-white" />
                Хуки для захвата внимания
              </h3>

              <div className="grid grid-cols-1 gap-[10px] md:grid-cols-2">
                {MOCK_HOOKS.map((hook) => (
                  <article
                    key={hook.id}
                    className="min-h-[92px] rounded-[12px] border border-white/12 bg-[#15151A] px-7 py-4 shadow-[0_16px_36px_rgba(0,0,0,0.14)]"
                  >
                    <div className="text-[13px] font-medium text-[#6D6D78]">{hook.id}</div>
                    <div className="mt-3 max-w-[460px] text-[15px] font-medium leading-[1.25] text-white">{hook.text}</div>
                  </article>
                ))}
              </div>
            </section>

            <section className="mt-[64px]">
              <h3 className="mb-8 flex items-center gap-4 text-[28px] font-black uppercase tracking-[-0.045em] text-white">
                <Heart size={26} className="text-white" />
                Общие рекомендации от AI-ассистента
              </h3>

              <article className="rounded-[18px] border border-white/12 bg-[#15151A] px-7 py-7 shadow-[0_20px_60px_rgba(0,0,0,0.16)] md:px-10 md:py-9">
                <div className={`overflow-hidden text-[15px] leading-[1.26] text-[#B8B8C0] ${isAdviceExpanded ? 'max-h-none' : 'max-h-[196px]'}`}>
                  {AI_RECOMMENDATIONS.map((line, index) => (
                    <p key={index} className={index === 0 ? '' : 'mt-1'}>
                      {line}
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
              </article>
            </section>
          </div>
        )}
      </main>

      <footer className="relative z-10 mt-auto border-t border-white/10 bg-[#15151A]">
        <div className="mx-auto w-full max-w-[1280px] px-6 py-12 md:px-12">
          <div className="flex flex-col gap-12 lg:flex-row lg:justify-between">
            <div className="max-w-[340px]">
              <div className="text-[22px] font-black uppercase tracking-[-0.05em] text-white">ALIGND</div>
              <p className="mt-5 text-[16px] leading-[1.32] text-[#A2A2AA]">
                AI-инструмент для создания вирусного контента.
                <br />
                Персонализированные тренды, идеи
                <br />
                и сценарии для TikTok и Instagram.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-x-12 gap-y-10 text-[15px] text-[#A2A2AA] sm:grid-cols-3">
              <div>
                <div className="mb-4 font-semibold text-[#D0D0D6]">Продукт</div>
                <div className="space-y-2">
                  <div>Возможности</div>
                  <div>API</div>
                </div>
              </div>
              <div>
                <div className="mb-4 font-semibold text-[#D0D0D6]">Компания</div>
                <div className="space-y-2">
                  <div>О нас</div>
                  <div>Контакты</div>
                </div>
              </div>
              <div>
                <div className="mb-4 font-semibold text-[#D0D0D6]">Правовое</div>
                <div className="space-y-2">
                  <div>Условия</div>
                  <div>Конфиденциальность</div>
                  <div>Cookie</div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-10 border-t border-white/12 pt-6">
            <div className="flex items-center justify-between gap-6 text-[14px] text-[#8B8B95]">
              <div>© 2026 Alignd</div>
              <div className="text-[16px] font-black uppercase tracking-[-0.05em] text-white">ALIGND</div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
