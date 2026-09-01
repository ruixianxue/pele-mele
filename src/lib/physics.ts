export interface CardSize {
  width: number;
  height: number;
  diag: number;
}

interface CardBody extends CardSize {
  id: string;
  x: number;
  y: number;
  rot: number;
  vx: number;
  vy: number;
  vrot: number;
  el: HTMLDivElement | null;
}

const FRICTION = 0.9;
const ROT_FRICTION = 0.88;
const EDGE_DAMPING = 0.35;
const REPULSION_STRENGTH = 0.02;
const SETTLE_EPSILON = 0.02;
const SETTLE_FRAMES = 12;
const PADDING = 12;

/**
 * A small imperative, DOM-driven physics sim for the photo pile. Positions
 * live outside React state and are written straight to element transforms
 * every frame — re-rendering ~40 absolutely-positioned cards through React
 * on every pointermove would visibly drop frames.
 */
export class PileSimulation {
  private bodies = new Map<string, CardBody>();
  private bounds = { width: 0, height: 0 };
  private rafId: number | null = null;
  private settledFrames = 0;
  // Off while cards sit in the stacked pile — a real stack overlaps almost
  // completely, so pairwise repulsion must not fight that placement. It
  // switches on for the scattered/thrown state, where cards should push
  // each other apart instead of piling up.
  private repulsionEnabled = false;

  setRepulsionEnabled(enabled: boolean) {
    this.repulsionEnabled = enabled;
  }

  setBounds(width: number, height: number) {
    this.bounds = { width, height };
    this.wake();
  }

  /** Mount-time only. Re-registering an id that's already tracked (e.g. a
   * React double-invoke, or a careless caller) must not reset its position —
   * see updateSize for the "same card, new size" case. */
  register(id: string, el: HTMLDivElement | null, size: CardSize) {
    const existing = this.bodies.get(id);
    if (existing) {
      existing.el = el;
      existing.width = size.width;
      existing.height = size.height;
      existing.diag = size.diag;
      return;
    }
    this.bodies.set(id, {
      id,
      el,
      x: this.bounds.width / 2,
      y: this.bounds.height / 2,
      rot: 0,
      vx: 0,
      vy: 0,
      vrot: 0,
      ...size,
    });
  }

  /**
   * Update a tracked card's box size in place (e.g. the whole pile resizes
   * as more photos join) without disturbing its position/rotation/velocity.
   */
  updateSize(id: string, size: CardSize) {
    const body = this.bodies.get(id);
    if (!body) return;
    body.width = size.width;
    body.height = size.height;
    body.diag = size.diag;
    this.applyTransform(body);
  }

  unregister(id: string) {
    this.bodies.delete(id);
  }

  setZIndex(id: string, z: number) {
    const body = this.bodies.get(id);
    if (body?.el) body.el.style.zIndex = String(z);
  }

  /** Snap a card straight to a resting position/rotation with zero velocity. */
  place(id: string, x: number, y: number, rot: number) {
    const body = this.bodies.get(id);
    if (!body) return;
    body.x = x;
    body.y = y;
    body.rot = rot;
    body.vx = body.vy = body.vrot = 0;
    this.applyTransform(body);
    this.wake();
  }

  /**
   * Fling every registered card outward from wherever it currently sits.
   * Used both for the initial explode (cards start clustered near the pile
   * anchor, so "outward from self" already reads as "outward from the
   * pile") and for a re-shuffle of an already-scattered layout.
   */
  scatterAll(power: number) {
    this.repulsionEnabled = true;
    for (const body of this.bodies.values()) {
      this.burst(body, power);
    }
    this.wake();
  }

  /**
   * Same outward fling as scatterAll, but for one card — used when a photo
   * is dropped into a pile that's already scattered, so it lands and hops
   * into the mix without disturbing everything already resting there.
   */
  burstOne(id: string, power: number) {
    const body = this.bodies.get(id);
    if (!body) return;
    this.repulsionEnabled = true;
    this.burst(body, power);
    this.wake();
  }

  private burst(body: CardBody, power: number) {
    const angle = Math.random() * Math.PI * 2;
    const towardCenter = Math.atan2(
      this.bounds.height / 2 - body.y,
      this.bounds.width / 2 - body.x,
    );
    const blended = towardCenter + (angle - towardCenter) * 0.7;
    const mag = power * (0.55 + Math.random() * 0.55);
    body.vx += Math.cos(blended) * mag;
    body.vy += Math.sin(blended) * mag;
    body.vrot += (Math.random() - 0.5) * mag * 0.9;
  }

  /** Apply a directional impulse from a pointer sweep to nearby cards. */
  sweep(pointerX: number, pointerY: number, dirX: number, dirY: number, speed: number) {
    if (speed <= 0) return;
    for (const body of this.bodies.values()) {
      const cx = body.x;
      const cy = body.y;
      const dist = Math.hypot(cx - pointerX, cy - pointerY);
      const radius = body.diag * 0.62 + 70;
      if (dist >= radius) continue;
      const falloff = 1 - dist / radius;
      const away = Math.atan2(cy - pointerY, cx - pointerX);
      const pushAngle = Math.atan2(dirY, dirX);
      // Mostly pushed along the sweep direction, with a little radial
      // shove so cards right under the cursor don't get walked over.
      const blend = 0.8;
      const angle = pushAngle * blend + away * (1 - blend);
      const mag = speed * falloff * 0.85;
      body.vx += Math.cos(angle) * mag;
      body.vy += Math.sin(angle) * mag;
      body.vrot += (Math.random() - 0.5) * mag * 0.4 * falloff;
    }
    this.wake();
  }

  private wake() {
    this.settledFrames = 0;
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(this.tick);
    }
  }

  private tick = () => {
    let maxSpeed = 0;
    const bodies = Array.from(this.bodies.values());

    if (this.repulsionEnabled) {
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i];
          const b = bodies[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.001;
          const minDist = (a.diag + b.diag) * 0.24;
          if (dist < minDist) {
            const overlap = (minDist - dist) * REPULSION_STRENGTH;
            const nx = dx / dist;
            const ny = dy / dist;
            a.vx -= nx * overlap;
            a.vy -= ny * overlap;
            b.vx += nx * overlap;
            b.vy += ny * overlap;
          }
        }
      }
    }

    for (const body of bodies) {
      body.vx *= FRICTION;
      body.vy *= FRICTION;
      body.vrot *= ROT_FRICTION;

      body.x += body.vx;
      body.y += body.vy;
      body.rot += body.vrot;

      const halfW = body.width / 2;
      const halfH = body.height / 2;
      const minX = halfW + PADDING;
      const maxX = this.bounds.width - halfW - PADDING;
      const minY = halfH + PADDING;
      const maxY = this.bounds.height - halfH - PADDING;

      if (maxX > minX) {
        if (body.x < minX) {
          body.x = minX;
          body.vx = Math.abs(body.vx) * EDGE_DAMPING;
        } else if (body.x > maxX) {
          body.x = maxX;
          body.vx = -Math.abs(body.vx) * EDGE_DAMPING;
        }
      }
      if (maxY > minY) {
        if (body.y < minY) {
          body.y = minY;
          body.vy = Math.abs(body.vy) * EDGE_DAMPING;
        } else if (body.y > maxY) {
          body.y = maxY;
          body.vy = -Math.abs(body.vy) * EDGE_DAMPING;
        }
      }

      this.applyTransform(body);
      maxSpeed = Math.max(maxSpeed, Math.abs(body.vx), Math.abs(body.vy), Math.abs(body.vrot));
    }

    if (maxSpeed < SETTLE_EPSILON) {
      this.settledFrames++;
    } else {
      this.settledFrames = 0;
    }

    if (this.settledFrames > SETTLE_FRAMES) {
      this.rafId = null;
      return;
    }
    this.rafId = requestAnimationFrame(this.tick);
  };

  private applyTransform(body: CardBody) {
    if (!body.el) return;
    const tx = body.x - body.width / 2;
    const ty = body.y - body.height / 2;
    body.el.style.transform = `translate3d(${tx}px, ${ty}px, 0) rotate(${body.rot}deg)`;
  }

  dispose() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.bodies.clear();
  }
}
