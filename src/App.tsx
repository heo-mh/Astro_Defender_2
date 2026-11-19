import { useEffect, useRef, useState } from 'react';
import {
  Crosshair,
  Pause,
  Play,
  RotateCcw,
  Shield,
  ShieldAlert,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { SpaceShooterEngine } from './game/engine';
import type { HudSnapshot } from './game/types';

const INITIAL_HUD: HudSnapshot = {
  state: 'TITLE_MENU',
  score: 0,
  highScore: 0,
  destroyed: 0,
  missed: 0,
  maxMissed: 3,
  level: 1,
  speedMultiplier: 1,
  gameOverReason: null,
  isNewRecord: false,
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<SpaceShooterEngine | null>(null);

  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [muted, setMuted] = useState(false);
  const [autoFire, setAutoFire] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new SpaceShooterEngine(canvas, (snapshot) => {
      setHud(snapshot);
    });
    engineRef.current = engine;

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  // Allow Enter or Space to start/restart cleanly (with brief lockout after Game Over)
  useEffect(() => {
    let unlockedAt = 0;
    if (hud.state === 'GAME_OVER') {
      unlockedAt = performance.now() + 450;
    }

    const handleQuickStart = (e: KeyboardEvent) => {
      if (e.code !== 'Enter' && e.code !== 'Space') return;
      if (hud.state === 'TITLE_MENU') {
        e.preventDefault();
        engineRef.current?.startGame();
      } else if (hud.state === 'GAME_OVER' && performance.now() >= unlockedAt) {
        e.preventDefault();
        engineRef.current?.startGame();
      }
    };

    window.addEventListener('keydown', handleQuickStart);
    return () => window.removeEventListener('keydown', handleQuickStart);
  }, [hud.state]);

  const handleStart = () => {
    engineRef.current?.startGame();
  };

  const handleTogglePause = () => {
    if (hud.state === 'PLAYING') {
      engineRef.current?.pauseGame();
    } else if (hud.state === 'PAUSED') {
      engineRef.current?.resumeGame();
    }
  };

  const handleToggleMute = () => {
    const next = !muted;
    setMuted(next);
    engineRef.current?.setMuted(next);
  };

  const handleToggleAutoFire = () => {
    const next = !autoFire;
    setAutoFire(next);
    engineRef.current?.setAutoFire(next);
  };

  const remainingShields = Math.max(0, hud.maxMissed - hud.missed);
  const shieldDanger = remainingShields <= 1;

  return (
    <div className="flex flex-col w-screen h-screen bg-[#050912] text-slate-100 overflow-hidden">
      {/* Unobtrusive Top HUD Header — 3 clean zones, zero pills, single-line controls */}
      <header className="shrink-0 h-14 px-4 sm:px-6 flex items-center justify-between gap-4 sm:gap-8 bg-[#0A1120]/95 border-b border-slate-800/80 z-20">
        {/* Zone 1: Brand Title */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => engineRef.current?.returnToTitle()}
            className="font-display text-base sm:text-lg font-bold tracking-tight text-slate-50 hover:text-sky-300 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 rounded"
          >
            지구 방위대
          </button>
          <span aria-hidden="true" className="hidden md:inline text-slate-600">
            ·
          </span>
          <span className="hidden md:inline text-xs font-medium text-slate-400 whitespace-nowrap shrink-0 font-mono-num">
            난이도 Lv.{hud.level} · 속도 {hud.speedMultiplier.toFixed(1)}x
          </span>
        </div>

        {/* Zone 2: Clean Unboxed Telemetry Readout */}
        <div
          className="flex items-center gap-3 sm:gap-5 text-xs sm:text-sm whitespace-nowrap shrink-0"
          aria-live="polite"
        >
          <div className="flex items-baseline gap-1.5">
            <span className="text-slate-400">점수</span>
            <span className="font-mono-num text-sm sm:text-base font-bold text-slate-50">
              {hud.score.toLocaleString()}
            </span>
          </div>

          <span aria-hidden="true" className="text-slate-700">
            /
          </span>

          <div className="hidden sm:flex items-baseline gap-1.5">
            <span className="text-slate-400">최고</span>
            <span className="font-mono-num text-sm font-semibold text-amber-300">
              {hud.highScore.toLocaleString()}
            </span>
          </div>

          <span aria-hidden="true" className="hidden sm:inline text-slate-700">
            /
          </span>

          {/* Earth Defense Integrity — explicit icon + count + label (never hue-only) */}
          <div
            className={`flex items-center gap-1.5 ${
              shieldDanger ? 'text-red-400' : 'text-sky-300'
            }`}
            title="지구로 암석이 3번 떨어지면 게임이 종료됩니다"
          >
            {shieldDanger ? (
              <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
            ) : (
              <Shield className="w-4 h-4 shrink-0" aria-hidden="true" />
            )}
            <span className="text-slate-400">
              <span className="hidden sm:inline">지구 방어</span>
              <span className="sm:hidden">지구</span>
            </span>
            <span className="font-mono-num font-bold">
              {remainingShields}/{hud.maxMissed}
            </span>
          </div>
        </div>

        {/* Zone 3: Functional Game Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={handleToggleAutoFire}
            aria-pressed={autoFire}
            className={`h-9 px-2.5 sm:px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 ${
              autoFire
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'bg-slate-800/70 text-slate-300 border border-slate-700/70 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="hidden sm:inline">자동 발사</span>
            <span className="font-mono-num text-[11px]">{autoFire ? 'ON' : 'OFF'}</span>
          </button>

          <button
            type="button"
            onClick={handleToggleMute}
            aria-label={muted ? '소리 켜기' : '소리 끄기'}
            className="h-9 w-9 rounded-lg flex items-center justify-center bg-slate-800/70 text-slate-300 border border-slate-700/70 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          >
            {muted ? (
              <VolumeX className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Volume2 className="w-4 h-4" aria-hidden="true" />
            )}
          </button>

          {(hud.state === 'PLAYING' || hud.state === 'PAUSED') && (
            <button
              type="button"
              onClick={handleTogglePause}
              aria-label={hud.state === 'PAUSED' ? '게임 계속하기' : '게임 일시정지'}
              className="h-9 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 bg-slate-800/80 text-slate-100 border border-slate-700 hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
            >
              {hud.state === 'PAUSED' ? (
                <>
                  <Play className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span className="hidden sm:inline">계속</span>
                </>
              ) : (
                <>
                  <Pause className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span className="hidden sm:inline">일시정지</span>
                </>
              )}
            </button>
          )}
        </div>
      </header>

      {/* Main Full-Viewport Space Arena */}
      <main className="relative flex-1 w-full overflow-hidden">
        <canvas
          ref={canvasRef}
          className="block w-full h-full cursor-crosshair"
          aria-label="지구 방위대 우주 슈팅 게임 화면"
        />

        {/* TITLE MENU OVERLAY */}
        {hud.state === 'TITLE_MENU' && (
          <div className="absolute inset-0 flex items-center justify-center p-4 bg-[#050912]/55 backdrop-blur-[2px]">
            <section className="w-full max-w-lg rounded-2xl bg-[#0D1526]/95 border border-slate-700/70 p-6 sm:p-8 shadow-2xl">
              <div className="text-center mb-6">
                <p className="text-xs font-medium text-sky-400 mb-2">
                  우주 방어 아케이드 슈팅
                </p>
                <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-white [text-wrap:balance]">
                  지구 방위대: 운석 요격
                </h1>
                <p className="mt-2.5 text-sm text-slate-300 leading-relaxed">
                  전투기를 자유롭게 조종하여 지구로 떨어지는 암석을 미사일로 파괴하세요.
                </p>
              </div>

              <div className="border-t border-b border-slate-800 py-5 space-y-3 text-sm text-slate-200">
                <div className="flex items-start justify-between gap-4">
                  <span className="text-slate-400 shrink-0">이동 조작</span>
                  <span className="text-right font-medium">
                    방향키 / WASD 또는 마우스·터치 드래그
                  </span>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <span className="text-slate-400 shrink-0">미사일 발사</span>
                  <span className="text-right font-medium">
                    스페이스바 / 클릭 유지 / 상단 자동 발사
                  </span>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <span className="text-slate-400 shrink-0">난이도 상승</span>
                  <span className="text-right font-medium">
                    점수가 오를수록 암석이 더 많고 빨라짐
                  </span>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <span className="text-slate-400 shrink-0">종료 조건</span>
                  <span className="text-right font-medium text-red-300">
                    전투기 충돌 또는 지구에 암석 3회 낙하
                  </span>
                </div>
              </div>

              <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-xs text-slate-400 flex items-center gap-2">
                  <span>최고 기록</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono-num text-sm font-bold text-amber-300">
                    {hud.highScore.toLocaleString()}점
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleStart}
                  className="w-full sm:w-auto px-7 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 active:scale-[0.98] text-slate-950 font-bold text-sm transition-all whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
                >
                  게임 시작
                </button>
              </div>
            </section>
          </div>
        )}

        {/* PAUSE OVERLAY */}
        {hud.state === 'PAUSED' && (
          <div className="absolute inset-0 flex items-center justify-center p-4 bg-[#050912]/70 backdrop-blur-xs">
            <section className="w-full max-w-sm rounded-2xl bg-[#0D1526]/95 border border-slate-700/70 p-6 sm:p-7 text-center shadow-2xl">
              <h2 className="font-display text-2xl font-bold text-white">일시정지</h2>
              <p className="mt-2 text-sm text-slate-300 font-mono-num">
                현재 점수 {hud.score.toLocaleString()}점 · 난이도 Lv.{hud.level}
              </p>

              <div className="mt-6 flex flex-col gap-2.5">
                <button
                  type="button"
                  onClick={handleTogglePause}
                  className="w-full py-2.5 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-sm transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
                >
                  계속하기
                </button>
                <button
                  type="button"
                  onClick={handleStart}
                  className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-medium text-sm border border-slate-700 transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
                >
                  처음부터 다시 시작
                </button>
              </div>
            </section>
          </div>
        )}

        {/* GAME OVER OVERLAY */}
        {hud.state === 'GAME_OVER' && (
          <div className="absolute inset-0 flex items-center justify-center p-4 bg-[#050912]/72 backdrop-blur-xs">
            <section className="w-full max-w-md rounded-2xl bg-[#0D1526]/96 border border-slate-700/75 p-6 sm:p-8 shadow-2xl">
              <div className="text-center">
                <p className="text-xs font-semibold text-red-400 mb-1.5">
                  {hud.gameOverReason === 'SHIP_COLLISION'
                    ? '전투기 충돌로 파괴됨'
                    : '지구 방어선 붕괴 (암석 3회 낙하)'}
                </p>
                <h2 className="font-display text-3xl font-extrabold text-white">
                  게임 종료
                </h2>
                {hud.isNewRecord && hud.score > 0 && (
                  <p className="mt-2 text-xs font-semibold text-amber-300">
                    새로운 최고 기록을 달성했습니다
                  </p>
                )}
              </div>

              <div className="mt-6 grid grid-cols-2 gap-y-4 gap-x-6 border-t border-b border-slate-800 py-5">
                <div>
                  <div className="text-xs text-slate-400">최종 점수</div>
                  <div className="mt-1 font-mono-num text-2xl font-bold text-white">
                    {hud.score.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">최고 점수</div>
                  <div className="mt-1 font-mono-num text-2xl font-bold text-amber-300">
                    {hud.highScore.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">파괴한 암석</div>
                  <div className="mt-1 font-mono-num text-lg font-semibold text-slate-200">
                    {hud.destroyed.toLocaleString()}개
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">도달 난이도</div>
                  <div className="mt-1 font-mono-num text-lg font-semibold text-sky-300">
                    Lv.{hud.level} ({hud.speedMultiplier.toFixed(1)}x)
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => engineRef.current?.returnToTitle()}
                  className="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm border border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
                >
                  메인으로
                </button>
                <button
                  type="button"
                  onClick={handleStart}
                  className="flex-1 py-3 px-5 rounded-xl bg-sky-500 hover:bg-sky-400 active:scale-[0.98] text-slate-950 font-bold text-sm flex items-center justify-center gap-2 transition-all whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
                >
                  <RotateCcw className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>다시 하기</span>
                </button>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
