export type GameState = 'TITLE_MENU' | 'PLAYING' | 'PAUSED' | 'GAME_OVER';

export type GameOverReason = 'SHIP_COLLISION' | 'EARTH_DESTROYED' | null;

export interface HudSnapshot {
  state: GameState;
  score: number;
  highScore: number;
  destroyed: number;
  missed: number;
  maxMissed: number;
  level: number;
  speedMultiplier: number;
  gameOverReason: GameOverReason;
  isNewRecord: boolean;
}

export interface Fighter {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  tilt: number;
  fireCooldown: number;
  muzzleFlash: number;
  thrusterPhase: number;
  alive: boolean;
}

export interface Missile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  length: number;
}

export interface AsteroidVertex {
  angle: number;
  dist: number;
}

export interface AsteroidCrater {
  x: number;
  y: number;
  r: number;
}

export interface Asteroid {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  rotation: number;
  rotationSpeed: number;
  points: number;
  vertices: AsteroidVertex[];
  craters: AsteroidCrater[];
  shade: string;
  highlight: string;
  stroke: string;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  life: number;
  maxLife: number;
  color: string;
  shape: 'circle' | 'shard';
  rotation: number;
  rotationSpeed: number;
}

export interface Shockwave {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
  color: string;
  lineWidth: number;
}

export interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  size: number;
}

export interface Star {
  x: number;
  y: number;
  size: number;
  speed: number;
  alpha: number;
  twinklePhase: number;
}
