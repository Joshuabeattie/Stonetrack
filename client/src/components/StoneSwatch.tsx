// A stone swatch: the stone's colour plus a generated texture (veins for marble,
// speckles for granite, mottling for limestone…). The same stone code always produces
// the same texture, so a worker can match a job on screen to a slab on the rack.
import { useMemo } from 'react'
import type { MaterialType } from '../../../shared/catalog'

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function random(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** Relative luminance (0 = black, 1 = white) of a #rrggbb colour. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const cache = new Map<string, string>()

/** Texture canvas size. Bigger canvases keep veins and grain fine when shown large. */
export interface TextureSize {
  w: number
  h: number
}
const SMALL: TextureSize = { w: 240, h: 140 }

/** The texture as an SVG document (no background: the stone colour sits underneath). */
export function swatchSvg(hex: string, type: MaterialType, seed: string, size: TextureSize = SMALL): string {
  const W = size.w
  const H = size.h
  const rnd = random(hash(seed))
  const light = luminance(hex) > 0.35
  const veinColour = light ? '96,92,86' : '232,229,222'
  const dark = light ? '58,55,50' : '8,8,8'
  const bright = light ? '255,255,255' : '205,201,192'
  const n = (min: number, max: number) => min + rnd() * (max - min)
  const parts: string[] = []

  // A vein is a gentle curve across the stone. Each main vein gets a few thin companions
  // running alongside it, which is what makes natural veining look fibrous rather than drawn.
  const curve = () => {
    // Veins drift gently across the slab rather than looping: a mostly straight line
    // with a little sideways movement at the two control points.
    const y0 = n(-0.2, 1.2) * H
    const drift = n(-0.6, 0.6) * H
    const bend = 0.12 * H
    const pts = [y0, y0 + drift * 0.33 + n(-bend, bend), y0 + drift * 0.66 + n(-bend, bend), y0 + drift]
    const xs = [-10, n(0.2, 0.4) * W, n(0.6, 0.8) * W, W + 10]
    return { xs, pts }
  }
  const pathOf = (c: { xs: number[]; pts: number[] }, wobble: number) => {
    const y = c.pts.map((p) => (p + n(-wobble, wobble)).toFixed(1))
    return `M${c.xs[0]} ${y[0]} C${c.xs[1].toFixed(1)} ${y[1]} ${c.xs[2].toFixed(1)} ${y[2]} ${c.xs[3]} ${y[3]}`
  }
  const stroke = (d: string, width: number, opacity: number) =>
    parts.push(`<path d="${d}" fill="none" stroke="rgba(${veinColour},${opacity.toFixed(2)})" stroke-width="${width.toFixed(2)}" stroke-linecap="round"/>`)
  const unit = Math.min(W, H) / 140 // keeps line weights in proportion on bigger canvases
  const veins = (count: number, maxWidth: number, maxOpacity: number) => {
    for (let i = 0; i < count; i++) {
      const c = curve()
      stroke(pathOf(c, 0), n(0.6, maxWidth) * unit, n(0.22, maxOpacity))
      for (let k = 0; k < 3; k++) stroke(pathOf(c, 6 * unit), n(0.25, 0.7) * unit, n(0.1, maxOpacity * 0.6))
    }
  }
  const clouds = (count: number) => {
    for (let i = 0; i < count; i++) stroke(pathOf(curve(), 0), n(10, 20) * unit, n(0.03, 0.06))
  }
  const specks = (count: number, minR: number, maxR: number, opacity: [number, number]) => {
    for (let i = 0; i < count; i++) {
      const colour = rnd() < 0.55 ? dark : bright
      parts.push(`<circle cx="${n(0, W).toFixed(1)}" cy="${n(0, H).toFixed(1)}" r="${n(minR, maxR).toFixed(2)}" fill="rgba(${colour},${n(opacity[0], opacity[1]).toFixed(2)})"/>`)
    }
  }

  switch (type) {
    case 'marble':
      clouds(2)
      veins(2, 2, 0.5)
      veins(3, 0.9, 0.3)
      break
    case 'quartzite':
      clouds(3)
      veins(2, 1.2, 0.3)
      specks(40, 0.4, 1, [0.1, 0.3])
      break
    case 'granite':
      specks(220, 0.4, 1.5, [0.25, 0.75])
      specks(14, 1.8, 3.4, [0.2, 0.45])
      break
    case 'sintered':
      specks(160, 0.3, 0.9, [0.12, 0.35])
      break
    case 'porcelain':
      if (light) {
        clouds(1)
        veins(2, 1.2, 0.35)
      } else specks(60, 3, 12, [0.04, 0.1])
      break
    case 'limestone':
      specks(40, 3, 10, [0.04, 0.1])
      specks(90, 0.4, 1.2, [0.15, 0.4])
      break
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">${parts.join('')}</svg>`
}

/** The texture as a data: URL, cached (generating it is cheap but lists render it often). */
export function swatchDataUrl(hex: string, type: MaterialType, seed: string, size: TextureSize = SMALL): string {
  const key = `${hex}|${type}|${seed}|${size.w}x${size.h}`
  let url = cache.get(key)
  if (!url) {
    url = `data:image/svg+xml,${encodeURIComponent(swatchSvg(hex, type, seed, size))}`
    cache.set(key, url)
  }
  return url
}

interface Props {
  hex: string
  type: MaterialType
  seed: string // the stone code, so every slab of a stone looks the same
  label?: string // set when the swatch carries meaning on its own
  className?: string
  size?: TextureSize // use a bigger canvas for big swatches (login, client page)
}

export function StoneSwatch({ hex, type, seed, label, className = '', size = SMALL }: Props) {
  const url = useMemo(() => swatchDataUrl(hex, type, seed, size), [hex, type, seed, size])
  return (
    <span
      className={`swatch ${className}`}
      style={{ backgroundColor: hex, backgroundImage: `url("${url}")` }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  )
}
