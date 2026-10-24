import { useState, type KeyboardEvent } from 'react'
import { cn } from '../ui/cn'

/**
 * Odontograma próprio, notação FDI. Cada dente tem o desenho anatômico (coroa + raízes, por tipo:
 * incisivo, canino, pré-molar, molar; decíduos menores). Faces tratadas aparecem como letras junto da
 * coroa; no modo de seleção, as faces de cada dente marcado são escolhidas por botões abaixo do desenho.
 * Desenhos feitos por nós, sem base em material de terceiros.
 * Faces: M mesial, D distal, O oclusal/incisal, V vestibular, L lingual/palatina.
 * Modos: "select" (montar orçamento: escolhe dentes e faces) e "view" (acompanhar: planejado em
 * vermelho, realizado em azul).
 * Teclado: Tab entre dentes, Espaço/Enter seleciona o dente, M D O V L alternam a face do dente em foco.
 */
export type Face = 'M' | 'D' | 'O' | 'V' | 'L'
export type ToothMark = { planned?: Face[] | 'all'; done?: Face[] | 'all'; note?: boolean }
export type Selection = Record<number, Face[]> // dente → faces (vazio = dente inteiro)

const FACE_NAME: Record<Face, string> = { M: 'mesial', D: 'distal', O: 'oclusal', V: 'vestibular', L: 'lingual' }

const PERMANENT = { upper: [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28], lower: [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38] }
const DECIDUOUS = { upper: [55, 54, 53, 52, 51, 61, 62, 63, 64, 65], lower: [85, 84, 83, 82, 81, 71, 72, 73, 74, 75] }

const quadrant = (t: number) => Math.floor(t / 10) % 4 || 4 // 1..4 (5..8 → 1..4)
const isUpper = (t: number) => [1, 2].includes(quadrant(t))
const isDeciduous = (t: number) => t >= 51


// ---------------------------------------------------------------------------
// Silhuetas (dente superior: raiz para cima, coroa para baixo), caixa 36 × 60.
// O inferior usa a mesma figura espelhada na vertical (molar inferior tem 2 raízes).
// ---------------------------------------------------------------------------
type Kind = 'incisor' | 'lateral' | 'canine' | 'premolar' | 'molarUp' | 'molarLow'

const CROWN_ROUND = 'C27.5 57 25 58 22 58 L14 58 C11 58 8.5 57 8.5 52.5' // borda incisal levemente curva
const SHAPES: Record<Kind, { outline: string; cervical: string }> = {
  incisor: {
    outline: `M12 33 C11.5 22 14.5 9 18 2.5 C21.5 9 24.5 22 24 33 C26.5 38 28.2 46 28 52.5 ${CROWN_ROUND} C8 46 9.5 38 12 33 Z`,
    cervical: 'M12 33 Q18 36 24 33',
  },
  lateral: {
    outline: 'M13 34 C12.5 23 15 11 18 5 C21 11 23.5 23 23 34 C25.5 39 27 46 26.6 52 C26.2 56 24 57.5 21.5 57.5 L14.5 57.5 C12 57.5 9.8 56 9.4 52 C9 46 10.5 39 13 34 Z',
    cervical: 'M13 34 Q18 36.5 23 34',
  },
  canine: {
    outline: 'M12.5 34 C11.5 20 14.5 6 18 0.5 C21.5 6 24.5 20 23.5 34 C26.5 39 28.3 45 27.6 50 C26.8 53.5 21.5 57.5 18 59 C14.5 57.5 9.2 53.5 8.4 50 C7.7 45 9.5 39 12.5 34 Z',
    cervical: 'M12.5 34 Q18 37 23.5 34',
  },
  premolar: {
    outline: 'M11 34 C10.5 22 13.5 9 18 4 C22.5 9 25.5 22 25 34 C28 38.5 29.8 45.5 29 51 C28.3 55 25.5 57.2 22.2 56.6 L18 54.4 L13.8 56.6 C10.5 57.2 7.7 55 7 51 C6.2 45.5 8 38.5 11 34 Z',
    cervical: 'M11 34 Q18 37 25 34',
  },
  molarUp: {
    outline: 'M6 36 C4.8 28 4.6 18 6.4 10 C7.3 6 11.8 6 12.6 10 L13.9 21.5 C14.2 23.6 15.4 23.6 15.7 21.5 L16.2 6.5 C16.6 2.6 20.4 2.6 20.8 6.5 L21.3 21.5 C21.6 23.6 22.8 23.6 23.1 21.5 L24.4 10 C25.2 6 29.7 6 30.6 10 C32.4 18 32.2 28 31 36 C33.2 41 34.3 47 33.4 52 C32.6 56 29.6 57.6 26.4 57 L24.2 55.2 L21.2 57.4 L18 55.6 L14.8 57.4 L11.8 55.2 L9.6 57 C6.4 57.6 3.4 56 2.6 52 C1.7 47 2.8 41 6 36 Z',
    cervical: 'M6 36 Q18 39.5 31 36',
  },
  molarLow: {
    outline: 'M5.5 36 C4.5 26 5.5 14 8.3 6.5 C9.1 4.2 11.5 4.4 11.8 6.9 L14 21.5 C14.4 24.2 16.2 25 18 25 C19.8 25 21.6 24.2 22 21.5 L24.2 6.9 C24.5 4.4 26.9 4.2 27.7 6.5 C30.5 14 31.5 26 30.5 36 C33 41 34.3 47 33.4 52 C32.6 56 29.6 57.6 26.4 57 L24.2 55.2 L21.2 57.4 L18 55.6 L14.8 57.4 L11.8 55.2 L9.6 57 C6.4 57.6 3.4 56 2.6 52 C1.7 47 3 41 5.5 36 Z',
    cervical: 'M5.5 36 Q18 39.5 30.5 36',
  },
}

function kindOf(t: number): Kind {
  const u = t % 10
  if (isDeciduous(t)) return u <= 1 ? 'incisor' : u === 2 ? 'lateral' : u === 3 ? 'canine' : isUpper(t) ? 'molarUp' : 'molarLow'
  if (u === 1) return 'incisor'
  if (u === 2) return 'lateral'
  if (u === 3) return 'canine'
  if (u <= 5) return 'premolar'
  return isUpper(t) ? 'molarUp' : 'molarLow'
}

const W = 36 // largura do dente
const SIL = 60 // altura da silhueta
const LETTERS = 16 // faixa das letras das faces tratadas (junto da coroa)
const TOOTH_H = SIL + LETTERS

const FACES: Face[] = ['M', 'D', 'O', 'V', 'L']
const order = (fs: Face[]) => FACES.filter((f) => fs.includes(f)).join('')

function Tooth({
  n, mark, selected, mode, onToggle, onPick,
}: {
  n: number
  mark?: ToothMark
  selected?: Face[]
  mode: 'select' | 'view'
  onToggle: (n: number, face: Face | null) => void
  onPick?: (n: number) => void
}) {
  const interactive = mode === 'select' || !!onPick
  const upper = isUpper(n)
  const shape = SHAPES[kindOf(n)]
  const isSel = selected !== undefined
  const whole = mark?.planned === 'all' ? 'planned' : mark?.done === 'all' ? 'done' : null
  const plannedFaces = mark?.planned && mark.planned !== 'all' ? mark.planned : []
  const doneFaces = mark?.done && mark.done !== 'all' ? mark.done : []
  const partial = !whole && (plannedFaces.length > 0 || doneFaces.length > 0)
  const silFill = isSel ? 'fill-tooth-selected/45' : whole === 'planned' ? 'fill-tooth-planned/85' : whole === 'done' ? 'fill-tooth-done/85' : 'fill-tooth-fill'
  const silStroke = isSel ? 'stroke-tooth-selected' : whole || partial ? (plannedFaces.length || whole === 'planned' ? 'stroke-tooth-planned' : 'stroke-tooth-done') : 'stroke-tooth-stroke'

  // superior: silhueta em cima, letras embaixo (perto da coroa); inferior: letras em cima, silhueta embaixo
  const silY = upper ? 0 : LETTERS
  const lettersY = upper ? SIL + 12 : 11
  const scale = isDeciduous(n) ? 0.86 : 1
  const selFaces = isSel && selected!.length ? order(selected!) : ''
  const summary = [
    whole === 'planned' && 'tratamento planejado no dente inteiro',
    whole === 'done' && 'tratamento realizado no dente inteiro',
    plannedFaces.length > 0 && `planejado nas faces ${plannedFaces.map((f) => FACE_NAME[f]).join(', ')}`,
    doneFaces.length > 0 && `realizado nas faces ${doneFaces.map((f) => FACE_NAME[f]).join(', ')}`,
    mark?.note && 'com anotação',
    isSel && (selected!.length ? `faces ${selected!.map((f) => FACE_NAME[f]).join(', ')} selecionadas` : 'selecionado'),
  ].filter(Boolean).join(', ')

  const onKey = (e: KeyboardEvent) => {
    const k = e.key.toUpperCase()
    if (mode === 'select' && 'MDOVL'.includes(k) && k.length === 1) { e.preventDefault(); onToggle(n, k as Face) }
  }
  const label = <text x={W / 2} y={upper ? -6 : TOOTH_H + 14} textAnchor="middle" className="fill-text-muted text-[11px] font-medium">{n}</text>

  return (
    <g
      role={interactive ? 'button' : 'img'}
      tabIndex={interactive ? 0 : -1}
      aria-pressed={mode === 'select' ? isSel : undefined}
      aria-label={`Dente ${n}${summary ? ', ' + summary : ''}`}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          if (mode === 'select') { e.preventDefault(); onToggle(n, null) }
          else if (onPick) { e.preventDefault(); onPick(n) }
        }
        onKey(e)
      }}
      onClick={() => { if (mode === 'view') onPick?.(n); else onToggle(n, null) }}
      className={cn('group outline-none', interactive && 'cursor-pointer')}
    >
      {label}
      <rect x={-3} y={-3} width={W + 6} height={TOOTH_H + 6} rx={5} className={cn('stroke-focus-ring stroke-2 opacity-0 group-focus-visible:opacity-100', 'fill-transparent')} />
      {/* área de clique do dente inteiro (inclui a faixa das letras) */}
      <rect x={0} y={0} width={W} height={TOOTH_H} className="fill-transparent" />
      <g transform={`translate(${(W * (1 - scale)) / 2} ${silY + (upper ? SIL * (1 - scale) : 0)}) ${upper ? '' : `translate(0 ${SIL * scale}) scale(1 -1)`} scale(${scale})`}>
        <path d={shape.outline} className={cn(silFill, silStroke, interactive && 'group-hover:brightness-95')} strokeWidth={1.2} strokeLinejoin="round" />
        <path d={shape.cervical} className={cn('fill-none', silStroke)} strokeWidth={0.8} opacity={0.6} />
      </g>
      {/* faces tratadas (ou selecionadas) como letras: vermelho planejado, azul realizado */}
      <text x={W / 2} y={lettersY} textAnchor="middle" className="text-[10px] font-semibold tracking-wide">
        {isSel ? <tspan className="fill-accent-text">{selFaces}</tspan> : (
          <>
            {plannedFaces.length > 0 && <tspan className="fill-tooth-planned">{order(plannedFaces)}</tspan>}
            {plannedFaces.length > 0 && doneFaces.length > 0 && <tspan className="fill-text-muted"> </tspan>}
            {doneFaces.length > 0 && <tspan className="fill-tooth-done">{order(doneFaces)}</tspan>}
          </>
        )}
      </text>
      {mark?.note && <circle cx={W - 3} cy={upper ? SIL - 4 : LETTERS + 4} r={3.5} className="fill-warning stroke-bg" strokeWidth={1} />}
    </g>
  )
}

export function Odontogram({
  mode, marks = {}, selection = {}, onSelectionChange, onPick, dentition: initial = 'permanent', facesHint,
}: {
  /** modo "select": texto sobre quando escolher faces (ex.: só para procedimento por face) */
  facesHint?: string
  mode: 'select' | 'view'
  /** modo "view": clicar/Enter num dente (ex.: abrir as anotações dele) */
  onPick?: (tooth: number) => void
  marks?: Record<number, ToothMark>
  selection?: Selection
  onSelectionChange?: (s: Selection) => void
  dentition?: 'permanent' | 'deciduous'
}) {
  const [dentition, setDentition] = useState(initial)
  const set = dentition === 'permanent' ? PERMANENT : DECIDUOUS
  const GAP = 6, MID = 18
  const half = set.upper.length / 2
  const x = (i: number) => i * (W + GAP) + (i >= half ? MID : 0)
  const width = x(set.upper.length - 1) + W
  const ROW_GAP = 26
  const lowerY = TOOTH_H + ROW_GAP
  const height = lowerY + TOOTH_H

  const toggle = (n: number, face: Face | null) => {
    if (!onSelectionChange) return
    const next = { ...selection }
    if (face === null) {
      if (next[n] !== undefined) delete next[n]
      else next[n] = []
    } else {
      const cur = next[n] ?? []
      const faces = cur.includes(face) ? cur.filter((f) => f !== face) : [...cur, face]
      if (faces.length === 0 && cur.length > 0) delete next[n]
      else next[n] = faces
    }
    onSelectionChange(next)
  }

  const row = (teeth: number[], y: number) =>
    teeth.map((n, i) => (
      <g key={n} transform={`translate(${x(i)} ${y})`}>
        <Tooth n={n} mark={marks[n]} selected={selection[n]} mode={mode} onToggle={toggle} onPick={onPick} />
      </g>
    ))

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Dentição" className="inline-flex w-fit rounded-md border border-border-strong p-0.5">
        {(['permanent', 'deciduous'] as const).map((d) => (
          <button
            key={d}
            role="radio"
            aria-checked={dentition === d}
            onClick={() => setDentition(d)}
            className={cn('h-8 rounded-sm px-3 text-sm', dentition === d ? 'bg-accent text-on-accent' : 'text-text hover:bg-surface')}
          >
            {d === 'permanent' ? 'Permanentes' : 'Decíduos'}
          </button>
        ))}
      </div>
      {/* No celular o desenho não encolhe abaixo de ~680px (dente tocável): rola para o lado. */}
      <div className="relative -mx-1 overflow-x-auto px-1 pb-1">
        <svg
          viewBox={`-6 -20 ${width + 12} ${height + 40}`}
          className="w-full min-w-[680px] max-w-[820px]"
          role="group"
          aria-label={mode === 'select' ? 'Odontograma: selecione dentes e faces' : 'Odontograma do paciente'}
        >
          {/* linha média e plano oclusal */}
          <line x1={x(half) - MID / 2 - GAP / 2} x2={x(half) - MID / 2 - GAP / 2} y1={-16} y2={height + 18} className="stroke-border-strong" strokeDasharray="3 3" />
          <line x1={-4} x2={width + 4} y1={TOOTH_H + ROW_GAP / 2} y2={TOOTH_H + ROW_GAP / 2} className="stroke-border-strong" strokeDasharray="3 3" />
          {row(set.upper, 0)}
          {row(set.lower, lowerY)}
        </svg>
      </div>
      {mode === 'select' && Object.keys(selection).length > 0 && (
        <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
          <legend className="px-1 text-xs font-semibold">Faces</legend>
          <p className="text-xs text-text-muted">{facesHint ?? 'Sem face marcada = dente inteiro.'} M mesial · D distal · O oclusal/incisal · V vestibular · L lingual/palatina.</p>
          <ul className="flex flex-col gap-1.5">
            {Object.keys(selection).map(Number).sort((a, b) => a - b).map((t) => (
              <li key={t} className="flex flex-wrap items-center gap-1.5">
                <span className="w-20 whitespace-nowrap text-sm font-medium">Dente {t}</span>
                {FACES.map((f) => {
                  const on = selection[t].includes(f)
                  return (
                    <button key={f} type="button" aria-pressed={on} aria-label={`Face ${FACE_NAME[f]} do dente ${t}`} title={FACE_NAME[f]}
                      onClick={() => toggle(t, f)}
                      className={cn('size-8 rounded-md border text-sm font-semibold', on ? 'border-accent bg-accent text-on-accent' : 'border-border-strong bg-bg text-text hover:bg-surface')}>
                      {f}
                    </button>
                  )
                })}
                <span className="text-xs text-text-muted">{selection[t].length ? '' : 'dente inteiro'}</span>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <ul className="flex flex-wrap gap-4 text-xs text-text-muted" aria-label="Legenda">
        <li className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-tooth-planned" />Planejado</li>
        <li className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-tooth-done" />Realizado</li>
        {mode === 'select' && <li className="flex items-center gap-1.5"><span className="size-3 rounded-sm border border-tooth-selected bg-tooth-selected/45" />Selecionado</li>}
        <li className="flex items-center gap-1.5"><span className="size-3 rounded-pill bg-warning" />Anotação</li>
        <li className="text-text-muted">{mode === 'select' ? 'Clique no dente para marcar; as faces, se precisar, logo abaixo.' : 'Dente pintado = tratamento no dente inteiro; letras = faces (ex.: OM).'}</li>
      </ul>
    </div>
  )
}
