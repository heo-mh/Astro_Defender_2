import { soundEngine } from './sound';
import type {
  Asteroid,
  AsteroidCrater,
  AsteroidVertex,
  Fighter,
  FloatingText,
  GameOverReason,
  GameState,
  HudSnapshot,
  Missile,
  Particle,
  Shockwave,
  Star,
} from './types';

const HIGH_SCORE_KEY = 'earth_defense_shooter_high_score_v1';
const BACKDROP_URL = '/src/assets/images/space_orbital_backdrop_1795100489652.jpg';
const MAX_MISSED = 3;

interface RockPalette {
  shade: string;
  highlight: string;
  stroke: string;
}

const ROCK_PALETTES: RockPalette[] = [
  { shade: '#475569', highlight: '#94A3B8', stroke: '#CBD5E1' },
  { shade: '#57534E', highlight: '#A8A29E', stroke: '#D6D3D1' },
  { shade: '#6B4C3B', highlight: '#B48A72', stroke: '#E7C8B5' },
  { shade: '#3F4B5B', highlight: '#7D8FA3', stroke: '#B8C7D9' },
];

export class SpaceShooterEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private onHudChange: (snapshot: HudSnapshot) => void;

  private width = 1280;
  private height = 720;
  private dpr = 1;

  private rafId: number | null = null;
  private lastTimestamp = 0;
  private resizeObserver: ResizeObserver | null = null;

  private backdropImg: HTMLImageElement | null = null;
  private backdropLoaded = false;

  // Game state
  private state: GameState = 'TITLE_MENU';
  private score = 0;
  private highScore = 0;
  private destroyed = 0;
  private missed = 0;
  private level = 1;
  private speedMultiplier = 1;
  private gameOverReason: GameOverReason = null;
  private isNewRecord = false;

  // Post-death/impact brief dramatic delay before showing Game Over modal
  private pendingGameOverReason: GameOverReason = null;
  private pendingGameOverTimer = 0;

  // Visual feedback timers
  private screenShake = 0;
  private earthFlash = 0;
  private levelBannerText = '';
  private levelBannerTimer = 0;

  // Entities
  private fighter: Fighter;
  private missiles: Missile[] = [];
  private asteroids: Asteroid[] = [];
  private particles: Particle[] = [];
  private shockwaves: Shockwave[] = [];
  private floatingTexts: FloatingText[] = [];
  private stars: Star[] = [];

  private nextAsteroidId = 1;
  private spawnTimer = 0.8;

  // Controls
  private keys = new Set<string>();
  private pointerActive = false;
  private pointerTarget: { x: number; y: number } | null = null;
  private pointerIsTouch = false;
  private autoFire = false;
  private reducedMotion = false;

  constructor(
    canvas: HTMLCanvasElement,
    onHudChange: (snapshot: HudSnapshot) => void,
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not initialize 2D canvas context');
    }
    this.ctx = ctx;
    this.onHudChange = onHudChange;

    this.highScore = this.loadHighScore();
    this.reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    this.fighter = this.createInitialFighter();
    this.loadBackdrop();
    this.handleResize();
    this.initStars();
    this.fighter = this.createInitialFighter();
    this.bindEvents();
    this.emitHud();
    this.startLoop();
  }

  private loadHighScore(): number {
    try {
      const saved = window.localStorage.getItem(HIGH_SCORE_KEY);
      const parsed = saved ? Number.parseInt(saved, 10) : 0;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch {
      return 0;
    }
  }

  private saveHighScore(val: number): void {
    try {
      window.localStorage.setItem(HIGH_SCORE_KEY, String(val));
    } catch {
      // Ignore storage quota / sandbox restrictions
    }
  }

  private loadBackdrop(): void {
    const img = new Image();
    img.onload = () => {
      this.backdropLoaded = true;
    };
    img.onerror = () => {
      this.backdropLoaded = false;
    };
    img.src = BACKDROP_URL;
    this.backdropImg = img;
  }

  private getEarthLineY(): number {
    const earthBand = Math.min(76, Math.max(48, this.height * 0.088));
    return this.height - earthBand;
  }

  private createInitialFighter(): Fighter {
    return {
      x: this.width / 2,
      y: Math.min(this.getEarthLineY() - 78, this.height * 0.78),
      vx: 0,
      vy: 0,
      radius: 17,
      tilt: 0,
      fireCooldown: 0,
      muzzleFlash: 0,
      thrusterPhase: 0,
      alive: true,
    };
  }

  private initStars(): void {
    const count = Math.min(130, Math.max(60, Math.floor((this.width * this.height) / 11000)));
    this.stars = [];
    for (let i = 0; i < count; i++) {
      const layer = Math.random();
      this.stars.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        size: layer < 0.65 ? 1.1 : layer < 0.9 ? 1.7 : 2.3,
        speed: layer < 0.65 ? 16 : layer < 0.9 ? 36 : 64,
        alpha: 0.25 + Math.random() * 0.65,
        twinklePhase: Math.random() * Math.PI * 2,
      });
    }
  }

  private handleResize = (): void => {
    const parent = this.canvas.parentElement;
    const rect = parent
      ? parent.getBoundingClientRect()
      : { width: window.innerWidth, height: window.innerHeight };

    const nextWidth = Math.max(320, Math.floor(rect.width));
    const nextHeight = Math.max(320, Math.floor(rect.height));

    const prevWidth = this.width;
    const prevHeight = this.height;

    this.width = nextWidth;
    this.height = nextHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    // Reposition fighter proportionally within new bounds
    if (this.fighter && prevWidth > 0 && prevHeight > 0) {
      const rx = this.fighter.x / prevWidth;
      const ry = this.fighter.y / prevHeight;
      this.fighter.x = this.clamp(rx * this.width, 30, this.width - 30);
      this.fighter.y = this.clamp(ry * this.height, 36, this.getEarthLineY() - 28);
    }

    if (this.stars.length > 0) {
      for (const s of this.stars) {
        s.x = (s.x / prevWidth) * this.width;
        s.y = (s.y / prevHeight) * this.height;
      }
    }
  };

  private bindEvents(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onWindowBlur);

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);

    if (typeof ResizeObserver !== 'undefined' && this.canvas.parentElement) {
      this.resizeObserver = new ResizeObserver(() => this.handleResize());
      this.resizeObserver.observe(this.canvas.parentElement);
    } else {
      window.addEventListener('resize', this.handleResize);
    }
  }

  public destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);

    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    } else {
      window.removeEventListener('resize', this.handleResize);
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const code = e.code;

    // Prevent browser scrolling on game keys
    if (
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'Space'
    ) {
      e.preventDefault();
    }

    if (code === 'KeyP' || code === 'Escape') {
      if (this.state === 'PLAYING' && !this.pendingGameOverReason) {
        this.pauseGame();
      } else if (this.state === 'PAUSED') {
        this.resumeGame();
      }
      return;
    }

    if (
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'KeyW' ||
      code === 'KeyA' ||
      code === 'KeyS' ||
      code === 'KeyD'
    ) {
      this.pointerTarget = null;
    }

    this.keys.add(code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onWindowBlur = (): void => {
    this.keys.clear();
    this.pointerActive = false;
    this.pointerTarget = null;
  };

  private getCanvasPoint(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.state !== 'PLAYING' || !this.fighter.alive) return;
    soundEngine.unlock();
    this.pointerActive = true;
    this.pointerIsTouch = e.pointerType === 'touch';
    const pt = this.getCanvasPoint(e);
    this.pointerTarget = {
      x: pt.x,
      y: this.pointerIsTouch ? pt.y - 46 : pt.y,
    };
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.pointerActive || this.state !== 'PLAYING') return;
    const pt = this.getCanvasPoint(e);
    this.pointerTarget = {
      x: pt.x,
      y: this.pointerIsTouch ? pt.y - 46 : pt.y,
    };
  };

  private onPointerUp = (): void => {
    this.pointerActive = false;
    this.pointerTarget = null;
  };

  // Public API for React controls
  public startGame(): void {
    soundEngine.unlock();
    this.state = 'PLAYING';
    this.score = 0;
    this.destroyed = 0;
    this.missed = 0;
    this.level = 1;
    this.speedMultiplier = 1;
    this.gameOverReason = null;
    this.isNewRecord = false;
    this.pendingGameOverReason = null;
    this.pendingGameOverTimer = 0;

    this.screenShake = 0;
    this.earthFlash = 0;
    this.levelBannerText = '';
    this.levelBannerTimer = 0;

    this.missiles = [];
    this.asteroids = [];
    this.particles = [];
    this.shockwaves = [];
    this.floatingTexts = [];
    this.keys.clear();
    this.pointerActive = false;
    this.pointerTarget = null;

    this.fighter = this.createInitialFighter();
    this.spawnTimer = 0.55;
    this.emitHud();
  }

  public pauseGame(): void {
    if (this.state !== 'PLAYING' || this.pendingGameOverReason) return;
    this.state = 'PAUSED';
    this.keys.clear();
    this.pointerActive = false;
    this.pointerTarget = null;
    this.emitHud();
  }

  public resumeGame(): void {
    if (this.state !== 'PAUSED') return;
    this.state = 'PLAYING';
    this.lastTimestamp = performance.now();
    this.emitHud();
  }

  public returnToTitle(): void {
    this.state = 'TITLE_MENU';
    this.pendingGameOverReason = null;
    this.pendingGameOverTimer = 0;
    this.missiles = [];
    this.asteroids = [];
    this.particles = [];
    this.shockwaves = [];
    this.floatingTexts = [];
    this.fighter = this.createInitialFighter();
    this.emitHud();
  }

  public setAutoFire(enabled: boolean): void {
    this.autoFire = enabled;
  }

  public setMuted(muted: boolean): void {
    soundEngine.setMuted(muted);
  }

  private emitHud(): void {
    this.onHudChange({
      state: this.state,
      score: this.score,
      highScore: this.highScore,
      destroyed: this.destroyed,
      missed: this.missed,
      maxMissed: MAX_MISSED,
      level: this.level,
      speedMultiplier: this.speedMultiplier,
      gameOverReason: this.gameOverReason,
      isNewRecord: this.isNewRecord,
    });
  }

  private startLoop(): void {
    this.lastTimestamp = performance.now();
    const frame = (now: number) => {
      const rawDt = (now - this.lastTimestamp) / 1000;
      this.lastTimestamp = now;
      // Clamp dt to avoid giant simulation jumps on tab switch
      const dt = Math.min(rawDt, 0.05);

      this.update(dt);
      this.render();

      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  private update(dt: number): void {
    // Always drift starfield smoothly for a living space arena
    const starBoost = this.state === 'PLAYING' ? 1 + (this.speedMultiplier - 1) * 0.45 : 0.45;
    for (const s of this.stars) {
      s.y += s.speed * starBoost * dt;
      s.twinklePhase += dt * 2.2;
      if (s.y > this.height + 4) {
        s.y = -4;
        s.x = Math.random() * this.width;
      }
    }

    if (this.state === 'TITLE_MENU') {
      // Gently hover the fighter in center during title screen
      this.fighter.thrusterPhase += dt * 14;
      this.fighter.x = this.width / 2;
      this.fighter.y = Math.min(this.getEarthLineY() - 82, this.height * 0.76) + Math.sin(performance.now() * 0.0022) * 5;
      this.fighter.tilt = Math.sin(performance.now() * 0.0014) * 0.06;
      return;
    }

    if (this.state === 'PAUSED' || this.state === 'GAME_OVER') {
      return;
    }

    // Visual timers
    if (this.screenShake > 0) {
      this.screenShake = Math.max(0, this.screenShake - dt * 28);
    }
    if (this.earthFlash > 0) {
      this.earthFlash = Math.max(0, this.earthFlash - dt * 2.4);
    }
    if (this.levelBannerTimer > 0) {
      this.levelBannerTimer = Math.max(0, this.levelBannerTimer - dt);
    }

    // Handle brief dramatic aftermath before showing Game Over modal
    if (this.pendingGameOverReason) {
      this.pendingGameOverTimer -= dt;
      this.updateEffects(dt);
      this.updateMissiles(dt);
      this.updateAsteroidsPassive(dt);
      if (this.pendingGameOverTimer <= 0) {
        this.finalizeGameOver(this.pendingGameOverReason);
      }
      return;
    }

    this.updateFighter(dt);
    this.updateSpawning(dt);
    this.updateMissiles(dt);
    this.updateAsteroids(dt);
    this.checkCollisions();
    this.updateEffects(dt);
  }

  private updateFighter(dt: number): void {
    const f = this.fighter;
    if (!f.alive) return;

    f.thrusterPhase += dt * 22;
    if (f.fireCooldown > 0) f.fireCooldown = Math.max(0, f.fireCooldown - dt);
    if (f.muzzleFlash > 0) f.muzzleFlash = Math.max(0, f.muzzleFlash - dt * 14);

    let inputX = 0;
    let inputY = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) inputX -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) inputX += 1;
    if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) inputY -= 1;
    if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) inputY += 1;

    const maxSpeed = 500;

    if (inputX !== 0 || inputY !== 0) {
      const len = Math.hypot(inputX, inputY);
      f.vx = (inputX / len) * maxSpeed;
      f.vy = (inputY / len) * maxSpeed;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
    } else if (this.pointerTarget) {
      const dx = this.pointerTarget.x - f.x;
      const dy = this.pointerTarget.y - f.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 2) {
        const followSpeed = Math.min(maxSpeed * 1.45, dist * 16);
        f.vx = (dx / dist) * followSpeed;
        f.vy = (dy / dist) * followSpeed;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
      } else {
        f.vx = 0;
        f.vy = 0;
      }
    } else {
      f.vx *= Math.pow(0.001, dt);
      f.vy *= Math.pow(0.001, dt);
    }

    // Clamp freely inside playable orbital space above Earth horizon
    const marginX = 28;
    const minY = 34;
    const maxY = this.getEarthLineY() - 28;
    f.x = this.clamp(f.x, marginX, this.width - marginX);
    f.y = this.clamp(f.y, minY, maxY);

    // Smooth visual banking on horizontal motion
    const targetTilt = this.clamp(f.vx / maxSpeed, -1, 1) * 0.24;
    f.tilt += (targetTilt - f.tilt) * Math.min(1, dt * 14);

    // Firing controls
    const wantsFire =
      this.autoFire ||
      this.keys.has('Space') ||
      this.keys.has('KeyZ') ||
      this.keys.has('Enter') ||
      this.pointerActive;

    if (wantsFire && f.fireCooldown <= 0) {
      this.fireMissile();
    }
  }

  private fireMissile(): void {
    const f = this.fighter;
    f.fireCooldown = 0.155;
    f.muzzleFlash = 1;

    // Dual wing-pod plasma missiles for crisp arcade feel
    const wingOffset = 11;
    const speed = 940;

    this.missiles.push(
      {
        x: f.x - wingOffset,
        y: f.y - 16,
        vx: 0,
        vy: -speed,
        radius: 4.5,
        length: 18,
      },
      {
        x: f.x + wingOffset,
        y: f.y - 16,
        vx: 0,
        vy: -speed,
        radius: 4.5,
        length: 18,
      },
    );

    soundEngine.playLaser();
  }

  private updateSpawning(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;

    // Scale spawn rate & wave density smoothly with score
    const baseInterval = Math.max(0.27, 1.22 * Math.pow(0.9, this.score / 260));
    const jitter = (Math.random() - 0.5) * baseInterval * 0.24;
    this.spawnTimer = Math.max(0.22, baseInterval + jitter);

    // Spawn primary asteroid
    this.spawnAsteroid();

    // At higher scores, spawn bonus simultaneous asteroids so density visibly climbs
    if (this.score >= 600) {
      const extraChance = Math.min(0.62, (this.score - 500) / 3600);
      if (Math.random() < extraChance) {
        this.spawnAsteroid();
      }
    }
    if (this.score >= 2200) {
      const tripleChance = Math.min(0.35, (this.score - 2000) / 4800);
      if (Math.random() < tripleChance) {
        this.spawnAsteroid();
      }
    }
  }

  private spawnAsteroid(): void {
    const roll = Math.random();
    let radius: number;
    let baseSpeed: number;
    let points: number;

    if (roll < 0.28) {
      // Small fast meteor
      radius = 15 + Math.random() * 6;
      baseSpeed = 148 + Math.random() * 48;
      points = 150;
    } else if (roll < 0.78) {
      // Medium standard asteroid
      radius = 23 + Math.random() * 9;
      baseSpeed = 112 + Math.random() * 42;
      points = 100;
    } else {
      // Large heavy boulder
      radius = 33 + Math.random() * 10;
      baseSpeed = 86 + Math.random() * 32;
      points = 100;
    }

    const margin = radius + 24;
    const x = margin + Math.random() * Math.max(40, this.width - margin * 2);
    const y = -radius - 16;

    // Gentle drift toward Earth's center / downward arc
    const vy = baseSpeed * this.speedMultiplier;
    const maxDrift = Math.min(85, 22 + this.level * 9);
    let vx = (Math.random() - 0.5) * 2 * maxDrift;

    // Steer gently inward if spawned near edges so it stays inside the arena
    if (x < this.width * 0.18 && vx < 0) vx = Math.abs(vx) * 0.7;
    if (x > this.width * 0.82 && vx > 0) vx = -Math.abs(vx) * 0.7;

    // Procedural jagged polygon vertices
    const vertexCount = 9 + Math.floor(Math.random() * 5);
    const vertices: AsteroidVertex[] = [];
    for (let i = 0; i < vertexCount; i++) {
      const angle = (i / vertexCount) * Math.PI * 2;
      const dist = radius * (0.76 + Math.random() * 0.28);
      vertices.push({ angle, dist });
    }

    // Surface craters for rocky depth
    const craterCount = radius > 28 ? 3 : 2;
    const craters: AsteroidCrater[] = [];
    for (let i = 0; i < craterCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const d = radius * (0.18 + Math.random() * 0.34);
      craters.push({
        x: Math.cos(angle) * d,
        y: Math.sin(angle) * d,
        r: Math.max(2.5, radius * (0.14 + Math.random() * 0.14)),
      });
    }

    const palette = ROCK_PALETTES[Math.floor(Math.random() * ROCK_PALETTES.length)];

    this.asteroids.push({
      id: this.nextAsteroidId++,
      x,
      y,
      vx,
      vy,
      radius,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 2.4,
      points,
      vertices,
      craters,
      shade: palette.shade,
      highlight: palette.highlight,
      stroke: palette.stroke,
    });
  }

  private updateMissiles(dt: number): void {
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.y < -30) {
        this.missiles.splice(i, 1);
      }
    }
  }

  private updateAsteroidsPassive(dt: number): void {
    for (let i = this.asteroids.length - 1; i >= 0; i--) {
      const a = this.asteroids[i];
      a.x += a.vx * dt * 0.35;
      a.y += a.vy * dt * 0.35;
      a.rotation += a.rotationSpeed * dt * 0.35;
    }
  }

  private updateAsteroids(dt: number): void {
    const earthLineY = this.getEarthLineY();

    for (let i = this.asteroids.length - 1; i >= 0; i--) {
      const a = this.asteroids[i];
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.rotation += a.rotationSpeed * dt;

      // Soft bounce off left/right edges so asteroids remain threats heading to Earth
      if (a.x < a.radius + 8 && a.vx < 0) {
        a.x = a.radius + 8;
        a.vx = -a.vx * 0.85;
      } else if (a.x > this.width - a.radius - 8 && a.vx > 0) {
        a.x = this.width - a.radius - 8;
        a.vx = -a.vx * 0.85;
      }

      // Check if asteroid fell into Earth
      if (a.y + a.radius * 0.45 >= earthLineY) {
        this.asteroids.splice(i, 1);
        this.handleEarthImpact(a.x, earthLineY);
      }
    }
  }

  private handleEarthImpact(impactX: number, earthLineY: number): void {
    this.missed = Math.min(MAX_MISSED, this.missed + 1);
    const isFatal = this.missed >= MAX_MISSED;

    this.earthFlash = 1;
    this.triggerShake(isFatal ? 18 : 11);
    soundEngine.playEarthImpact(isFatal);

    // Impact shockwave & fiery plume along Earth's atmosphere
    this.shockwaves.push({
      x: impactX,
      y: earthLineY,
      radius: 10,
      maxRadius: isFatal ? 180 : 115,
      alpha: 0.95,
      color: '#EF4444',
      lineWidth: isFatal ? 4 : 3,
    });

    for (let i = 0; i < (isFatal ? 42 : 24); i++) {
      const angle = -Math.PI + Math.random() * Math.PI;
      const speed = 70 + Math.random() * 240;
      this.particles.push({
        x: impactX,
        y: earthLineY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2.5 + Math.random() * 4.5,
        alpha: 1,
        life: 0,
        maxLife: 0.45 + Math.random() * 0.45,
        color: i % 3 === 0 ? '#FCA5A5' : i % 2 === 0 ? '#F97316' : '#EF4444',
        shape: i % 4 === 0 ? 'shard' : 'circle',
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 8,
      });
    }

    const label = isFatal
      ? `지구 방어 실패! (${this.missed}/${MAX_MISSED})`
      : `지구 피격! (${this.missed}/${MAX_MISSED})`;

    this.floatingTexts.push({
      x: this.clamp(impactX, 95, this.width - 95),
      y: earthLineY - 26,
      text: label,
      color: '#FCA5A5',
      alpha: 1,
      life: 0,
      maxLife: 1.25,
      size: 15,
    });

    this.emitHud();

    if (isFatal) {
      this.pendingGameOverReason = 'EARTH_DESTROYED';
      this.pendingGameOverTimer = 0.65;
    }
  }

  private checkCollisions(): void {
    // 1. Missiles vs Asteroids
    for (let mi = this.missiles.length - 1; mi >= 0; mi--) {
      const m = this.missiles[mi];
      let hit = false;

      for (let ai = this.asteroids.length - 1; ai >= 0; ai--) {
        const a = this.asteroids[ai];
        const dx = m.x - a.x;
        const dy = m.y - a.y;
        const hitRadius = a.radius + m.radius + 4;

        if (dx * dx + dy * dy <= hitRadius * hitRadius) {
          this.destroyAsteroid(ai);
          hit = true;
          break;
        }
      }

      if (hit) {
        this.missiles.splice(mi, 1);
      }
    }

    // 2. Fighter vs Asteroids
    if (!this.fighter.alive || this.pendingGameOverReason) return;

    const f = this.fighter;
    for (let ai = this.asteroids.length - 1; ai >= 0; ai--) {
      const a = this.asteroids[ai];
      const dx = f.x - a.x;
      const dy = f.y - a.y;
      const collideRadius = f.radius + a.radius * 0.84;

      if (dx * dx + dy * dy <= collideRadius * collideRadius) {
        this.destroyAsteroid(ai, false);
        this.handleFighterDestroyed();
        break;
      }
    }
  }

  private destroyAsteroid(index: number, awardPoints = true): void {
    const a = this.asteroids[index];
    this.asteroids.splice(index, 1);

    const scale = a.radius / 26;
    if (awardPoints) {
      soundEngine.playAsteroidExplosion(scale);
      this.triggerShake(Math.min(7, 3 + scale * 2.5));
    }

    // Shockwave ring
    this.shockwaves.push({
      x: a.x,
      y: a.y,
      radius: a.radius * 0.35,
      maxRadius: a.radius * 2.35,
      alpha: 0.85,
      color: '#F59E0B',
      lineWidth: 2.5,
    });

    // Fiery burst + rocky shards
    const count = Math.floor(14 + scale * 12);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 55 + Math.random() * (165 * scale);
      const isRock = i % 3 === 0;
      this.particles.push({
        x: a.x + (Math.random() - 0.5) * a.radius * 0.5,
        y: a.y + (Math.random() - 0.5) * a.radius * 0.5,
        vx: Math.cos(angle) * speed + a.vx * 0.25,
        vy: Math.sin(angle) * speed + a.vy * 0.2,
        size: isRock ? 3.5 + Math.random() * 4.5 : 2 + Math.random() * 3.5,
        alpha: 1,
        life: 0,
        maxLife: 0.34 + Math.random() * 0.38,
        color: isRock
          ? a.highlight
          : i % 2 === 0
            ? '#FDE047'
            : '#FB923C',
        shape: isRock ? 'shard' : 'circle',
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 10,
      });
    }

    if (!awardPoints) return;

    this.score += a.points;
    this.destroyed += 1;

    if (this.score > this.highScore) {
      this.highScore = this.score;
      this.isNewRecord = true;
      this.saveHighScore(this.highScore);
    }

    // Difficulty progression tied directly to score
    const nextLevel = Math.floor(this.score / 500) + 1;
    this.speedMultiplier = Number((1 + Math.min(2.4, this.score / 1800)).toFixed(2));

    if (nextLevel > this.level) {
      this.level = nextLevel;
      this.levelBannerText = `난이도 상승 · Lv.${this.level}`;
      this.levelBannerTimer = 2.0;
      soundEngine.playLevelUp();
    }

    this.floatingTexts.push({
      x: a.x,
      y: a.y - 6,
      text: `+${a.points}`,
      color: a.points >= 150 ? '#FDE047' : '#F8FAFC',
      alpha: 1,
      life: 0,
      maxLife: 0.72,
      size: a.points >= 150 ? 15 : 13,
    });

    this.emitHud();
  }

  private handleFighterDestroyed(): void {
    const f = this.fighter;
    f.alive = false;
    this.triggerShake(20);
    soundEngine.playShipExplosion();

    this.shockwaves.push(
      {
        x: f.x,
        y: f.y,
        radius: 8,
        maxRadius: 110,
        alpha: 1,
        color: '#38BDF8',
        lineWidth: 3.5,
      },
      {
        x: f.x,
        y: f.y,
        radius: 4,
        maxRadius: 72,
        alpha: 0.95,
        color: '#F97316',
        lineWidth: 2.5,
      },
    );

    for (let i = 0; i < 46; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 290;
      const colors = ['#38BDF8', '#E0F2FE', '#F97316', '#FDE047', '#EF4444'];
      this.particles.push({
        x: f.x,
        y: f.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2.5 + Math.random() * 5,
        alpha: 1,
        life: 0,
        maxLife: 0.48 + Math.random() * 0.5,
        color: colors[i % colors.length],
        shape: i % 3 === 0 ? 'shard' : 'circle',
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 12,
      });
    }

    this.floatingTexts.push({
      x: f.x,
      y: f.y - 18,
      text: '전투기 파괴!',
      color: '#FCA5A5',
      alpha: 1,
      life: 0,
      maxLife: 1.1,
      size: 16,
    });

    this.pendingGameOverReason = 'SHIP_COLLISION';
    this.pendingGameOverTimer = 0.65;
  }

  private finalizeGameOver(reason: GameOverReason): void {
    this.pendingGameOverReason = null;
    this.pendingGameOverTimer = 0;
    this.gameOverReason = reason;
    this.state = 'GAME_OVER';
    this.keys.clear();
    this.pointerActive = false;
    this.pointerTarget = null;
    this.emitHud();
  }

  private updateEffects(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.18, dt);
      p.vy *= Math.pow(0.18, dt);
      p.rotation += p.rotationSpeed * dt;
      p.alpha = 1 - p.life / p.maxLife;
    }

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.radius += (sw.maxRadius - sw.radius) * Math.min(1, dt * 8.5);
      sw.alpha -= dt * 2.1;
      if (sw.alpha <= 0.02) {
        this.shockwaves.splice(i, 1);
      }
    }

    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.life += dt;
      if (ft.life >= ft.maxLife) {
        this.floatingTexts.splice(i, 1);
        continue;
      }
      ft.y -= 36 * dt;
      ft.alpha = 1 - Math.pow(ft.life / ft.maxLife, 1.5);
    }
  }

  private triggerShake(intensity: number): void {
    if (this.reducedMotion) return;
    this.screenShake = Math.max(this.screenShake, intensity);
  }

  private clamp(val: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, val));
  }

  // =========================================================================
  // RENDERING
  // =========================================================================

  private render(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // Apply micro screen shake
    if (this.screenShake > 0.2) {
      const sx = (Math.random() - 0.5) * this.screenShake;
      const sy = (Math.random() - 0.5) * this.screenShake;
      ctx.translate(sx, sy);
    }

    this.renderBackground(ctx);
    this.renderStars(ctx);
    this.renderEarthHorizon(ctx);
    this.renderMissiles(ctx);
    this.renderAsteroids(ctx);
    if (this.fighter.alive) {
      this.renderFighter(ctx);
    }
    this.renderShockwaves(ctx);
    this.renderParticles(ctx);
    this.renderFloatingTexts(ctx);
    this.renderLevelBanner(ctx);

    ctx.restore();
  }

  private renderBackground(ctx: CanvasRenderingContext2D): void {
    // Deep space fallback gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 0, this.height);
    bgGrad.addColorStop(0, '#04070F');
    bgGrad.addColorStop(0.75, '#070E1C');
    bgGrad.addColorStop(1, '#0B1A33');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, this.width, this.height);

    // Draw generated orbital Earth backdrop aligned cleanly to the bottom edge
    if (this.backdropLoaded && this.backdropImg) {
      const img = this.backdropImg;
      const imgAspect = img.naturalWidth / Math.max(1, img.naturalHeight);
      const viewAspect = this.width / Math.max(1, this.height);

      let drawW = this.width;
      let drawH = this.height;
      let offsetX = 0;
      let offsetY = 0;

      if (viewAspect > imgAspect) {
        drawW = this.width;
        drawH = this.width / imgAspect;
        offsetY = this.height - drawH;
      } else {
        drawH = this.height;
        drawW = this.height * imgAspect;
        offsetX = (this.width - drawW) / 2;
      }

      ctx.save();
      ctx.globalAlpha = 0.88;
      ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
      ctx.restore();
    }
  }

  private renderStars(ctx: CanvasRenderingContext2D): void {
    for (const s of this.stars) {
      const twinkle = 0.72 + Math.sin(s.twinklePhase) * 0.28;
      ctx.fillStyle = `rgba(226, 232, 240, ${(s.alpha * twinkle).toFixed(3)})`;
      ctx.fillRect(s.x, s.y, s.size, s.size);
    }
  }

  private renderEarthHorizon(ctx: CanvasRenderingContext2D): void {
    const earthLineY = this.getEarthLineY();

    // Subtle glowing atmospheric arc / defense line so the Earth impact threshold is unmistakably clear
    const glowGrad = ctx.createLinearGradient(0, earthLineY - 26, 0, this.height);
    if (this.earthFlash > 0.05) {
      glowGrad.addColorStop(0, 'rgba(239, 68, 68, 0)');
      glowGrad.addColorStop(0.55, `rgba(239, 68, 68, ${(0.28 * this.earthFlash).toFixed(3)})`);
      glowGrad.addColorStop(1, `rgba(185, 28, 28, ${(0.42 * this.earthFlash).toFixed(3)})`);
    } else {
      glowGrad.addColorStop(0, 'rgba(56, 189, 248, 0)');
      glowGrad.addColorStop(0.55, 'rgba(56, 189, 248, 0.11)');
      glowGrad.addColorStop(1, 'rgba(14, 116, 144, 0.22)');
    }

    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, earthLineY - 26, this.width, this.height - (earthLineY - 26));

    // Crisp orbital defense boundary arc
    ctx.save();
    ctx.beginPath();
    const curveLift = Math.min(18, this.height * 0.022);
    ctx.moveTo(0, earthLineY + curveLift);
    ctx.quadraticCurveTo(this.width / 2, earthLineY - curveLift, this.width, earthLineY + curveLift);

    if (this.earthFlash > 0.05) {
      ctx.strokeStyle = `rgba(248, 113, 113, ${(0.45 + 0.55 * this.earthFlash).toFixed(2)})`;
      ctx.lineWidth = 2.5;
    } else if (this.missed === MAX_MISSED - 1) {
      ctx.strokeStyle = 'rgba(251, 146, 60, 0.55)';
      ctx.lineWidth = 1.8;
    } else {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.36)';
      ctx.lineWidth = 1.5;
    }
    ctx.setLineDash([8, 8]);
    ctx.stroke();
    ctx.restore();

    // Quiet Earth Defense Zone label anchored softly at bottom center
    ctx.save();
    ctx.font = '500 11px "Noto Sans KR", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle =
      this.earthFlash > 0.1
        ? 'rgba(254, 202, 202, 0.92)'
        : 'rgba(148, 163, 184, 0.65)';
    ctx.fillText('지구 대기권 방어선', this.width / 2, this.height - 14);
    ctx.restore();
  }

  private renderFighter(ctx: CanvasRenderingContext2D): void {
    const f = this.fighter;

    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.tilt);

    // Thruster flames (twin ion engines)
    const thrustBoost = f.vy < -30 ? 1.38 : f.vy > 30 ? 0.68 : 1.0;
    const flameLen = (15 + Math.sin(f.thrusterPhase) * 4.5) * thrustBoost;

    for (const offset of [-7.5, 7.5]) {
      const grad = ctx.createLinearGradient(offset, 14, offset, 14 + flameLen);
      grad.addColorStop(0, 'rgba(224, 242, 254, 0.95)');
      grad.addColorStop(0.4, 'rgba(56, 189, 248, 0.85)');
      grad.addColorStop(1, 'rgba(56, 189, 248, 0)');

      ctx.beginPath();
      ctx.moveTo(offset - 3.2, 14);
      ctx.lineTo(offset, 14 + flameLen);
      ctx.lineTo(offset + 3.2, 14);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // Muzzle flash on wing pods when firing
    if (f.muzzleFlash > 0.05) {
      ctx.save();
      ctx.globalAlpha = f.muzzleFlash;
      for (const offset of [-11, 11]) {
        const flashGrad = ctx.createRadialGradient(offset, -16, 1, offset, -16, 9);
        flashGrad.addColorStop(0, '#FEF08A');
        flashGrad.addColorStop(0.5, 'rgba(245, 158, 11, 0.7)');
        flashGrad.addColorStop(1, 'rgba(245, 158, 11, 0)');
        ctx.fillStyle = flashGrad;
        ctx.beginPath();
        ctx.arc(offset, -16, 9, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Swept main wings
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(25, 11);
    ctx.lineTo(22, 15);
    ctx.lineTo(10, 12);
    ctx.lineTo(8, 16);
    ctx.lineTo(-8, 16);
    ctx.lineTo(-10, 12);
    ctx.lineTo(-22, 15);
    ctx.lineTo(-25, 11);
    ctx.closePath();

    const wingGrad = ctx.createLinearGradient(-25, 0, 25, 0);
    wingGrad.addColorStop(0, '#64748B');
    wingGrad.addColorStop(0.5, '#CBD5E1');
    wingGrad.addColorStop(1, '#64748B');
    ctx.fillStyle = wingGrad;
    ctx.fill();
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Twin wing-mounted missile pods
    ctx.fillStyle = '#334155';
    ctx.fillRect(-13, -12, 4, 14);
    ctx.fillRect(9, -12, 4, 14);
    ctx.fillStyle = '#F59E0B';
    ctx.fillRect(-12.5, -14, 3, 3);
    ctx.fillRect(9.5, -14, 3, 3);

    // Central fuselage
    ctx.beginPath();
    ctx.moveTo(0, -26);
    ctx.lineTo(8.5, -4);
    ctx.lineTo(6.5, 16);
    ctx.lineTo(-6.5, 16);
    ctx.lineTo(-8.5, -4);
    ctx.closePath();

    const bodyGrad = ctx.createLinearGradient(-8, -24, 8, 16);
    bodyGrad.addColorStop(0, '#F8FAFC');
    bodyGrad.addColorStop(0.55, '#CBD5E1');
    bodyGrad.addColorStop(1, '#475569');
    ctx.fillStyle = bodyGrad;
    ctx.fill();

    // Sky-blue tactical wing stripes
    ctx.fillStyle = '#0EA5E9';
    ctx.beginPath();
    ctx.moveTo(-16, 4);
    ctx.lineTo(-11, 0);
    ctx.lineTo(-11, 7);
    ctx.lineTo(-17, 10);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(16, 4);
    ctx.lineTo(11, 0);
    ctx.lineTo(11, 7);
    ctx.lineTo(17, 10);
    ctx.closePath();
    ctx.fill();

    // Cockpit glass canopy
    ctx.beginPath();
    ctx.ellipse(0, -7, 3.6, 8.2, 0, 0, Math.PI * 2);
    const canopyGrad = ctx.createLinearGradient(0, -15, 0, 2);
    canopyGrad.addColorStop(0, '#7DD3FC');
    canopyGrad.addColorStop(0.6, '#0284C7');
    canopyGrad.addColorStop(1, '#0C4A6E');
    ctx.fillStyle = canopyGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(224, 242, 254, 0.75)';
    ctx.lineWidth = 0.9;
    ctx.stroke();

    ctx.restore();
  }

  private renderMissiles(ctx: CanvasRenderingContext2D): void {
    for (const m of this.missiles) {
      // Luminous tail
      const trailGrad = ctx.createLinearGradient(m.x, m.y - 6, m.x, m.y + m.length + 10);
      trailGrad.addColorStop(0, '#FEF08A');
      trailGrad.addColorStop(0.35, '#F59E0B');
      trailGrad.addColorStop(1, 'rgba(245, 158, 11, 0)');

      ctx.strokeStyle = trailGrad;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(m.x, m.y - 4);
      ctx.lineTo(m.x, m.y + m.length + 6);
      ctx.stroke();

      // Bright core warhead
      ctx.fillStyle = '#FFFBEB';
      ctx.beginPath();
      ctx.ellipse(m.x, m.y - 2, 2.2, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private renderAsteroids(ctx: CanvasRenderingContext2D): void {
    const earthLineY = this.getEarthLineY();

    for (const a of this.asteroids) {
      const distToEarth = Math.max(0, earthLineY - a.y);
      const heatRatio = distToEarth < 190 ? 1 - distToEarth / 190 : 0;

      // Atmospheric entry heat glow when asteroid nears Earth
      if (heatRatio > 0.05) {
        ctx.save();
        const heatGrad = ctx.createRadialGradient(
          a.x,
          a.y + a.radius * 0.45,
          a.radius * 0.2,
          a.x,
          a.y + a.radius * 0.45,
          a.radius * 1.55,
        );
        heatGrad.addColorStop(0, `rgba(251, 146, 60, ${(0.55 * heatRatio).toFixed(2)})`);
        heatGrad.addColorStop(0.55, `rgba(239, 68, 68, ${(0.28 * heatRatio).toFixed(2)})`);
        heatGrad.addColorStop(1, 'rgba(239, 68, 68, 0)');
        ctx.fillStyle = heatGrad;
        ctx.beginPath();
        ctx.arc(a.x, a.y + a.radius * 0.3, a.radius * 1.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.rotation);

      // Rocky polygon body
      ctx.beginPath();
      a.vertices.forEach((v, idx) => {
        const vx = Math.cos(v.angle) * v.dist;
        const vy = Math.sin(v.angle) * v.dist;
        if (idx === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      });
      ctx.closePath();

      const rockGrad = ctx.createRadialGradient(
        -a.radius * 0.3,
        -a.radius * 0.3,
        a.radius * 0.1,
        0,
        0,
        a.radius * 1.15,
      );
      rockGrad.addColorStop(0, a.highlight);
      rockGrad.addColorStop(0.65, a.shade);
      rockGrad.addColorStop(1, '#1E293B');

      ctx.fillStyle = rockGrad;
      ctx.fill();

      ctx.strokeStyle = heatRatio > 0.3 ? '#FB923C' : a.stroke;
      ctx.lineWidth = heatRatio > 0.3 ? 1.6 : 1.1;
      ctx.stroke();

      // Surface craters
      for (const c of a.craters) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.38)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.18)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  private renderShockwaves(ctx: CanvasRenderingContext2D): void {
    for (const sw of this.shockwaves) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, sw.alpha);
      ctx.strokeStyle = sw.color;
      ctx.lineWidth = sw.lineWidth;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private renderParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;

      if (p.shape === 'shard') {
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.lineTo(p.size * 0.85, p.size * 0.55);
        ctx.lineTo(-p.size * 0.75, p.size * 0.75);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  private renderFloatingTexts(ctx: CanvasRenderingContext2D): void {
    for (const ft of this.floatingTexts) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, ft.alpha);
      ctx.font = `700 ${ft.size}px "JetBrains Mono", "Noto Sans KR", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = ft.color;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
      ctx.shadowBlur = 6;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }
  }

  private renderLevelBanner(ctx: CanvasRenderingContext2D): void {
    if (this.levelBannerTimer <= 0 || !this.levelBannerText) return;

    const alpha =
      this.levelBannerTimer > 1.6
        ? (2.0 - this.levelBannerTimer) / 0.4
        : Math.min(1, this.levelBannerTimer / 0.5);

    ctx.save();
    ctx.globalAlpha = this.clamp(alpha, 0, 1);
    ctx.font = '700 18px "Outfit", "Noto Sans KR", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FDE047';
    ctx.shadowColor = 'rgba(245, 158, 11, 0.5)';
    ctx.shadowBlur = 12;
    ctx.fillText(this.levelBannerText, this.width / 2, 54);
    ctx.restore();
  }
}
