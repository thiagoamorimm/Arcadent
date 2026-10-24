// Gera frontend/src/styles/tokens.css a partir de design/tokens.json e confere o contraste.
// Rode depois de qualquer mudança de cor ou medida:
//   node design/build-tokens.mjs
// Contraste (WCAG 2): texto >= 4.5:1; pares marcados "ui" (bordas, ícones, foco) >= 3:1.
// Algum par abaixo do mínimo: lista e sai com erro, sem gerar o CSS.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const t = JSON.parse(readFileSync(join(here, 'tokens.json'), 'utf8'));
const out = join(here, '..', 'frontend', 'src', 'styles', 'tokens.css');

// ---------- contraste ----------
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (hex) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const failing = [];
for (const [fg, bg, kind] of t.pairs ?? []) {
  const r = ratio(t.color[fg], t.color[bg]);
  const min = kind === 'ui' ? 3 : 4.5;
  if (r < min) failing.push(`${fg} sobre ${bg}: ${r.toFixed(2)}:1 (mínimo ${min}:1)`);
}
if (failing.length) {
  console.error('Contraste insuficiente:\n  ' + failing.join('\n  '));
  process.exit(1);
}
console.log(`contraste ok: ${(t.pairs ?? []).length} pares`);

// ---------- CSS ----------
const px = (n) => `${n}px`;
const root = [];
const theme = [];

// Cores: variável crua em :root, papel no tema do Tailwind (bg-surface, text-muted...).
// "--color-*: initial" apaga a paleta padrão do Tailwind: só existem os nossos papéis.
theme.push('  --color-*: initial;', '  --color-transparent: transparent;', '  --color-current: currentColor;');
for (const [name, hex] of Object.entries(t.color)) {
  root.push(`  --c-${name}: ${hex};`);
  theme.push(`  --color-${name}: var(--c-${name});`);
}

theme.push(`  --font-sans: ${t.font.sans};`, `  --font-mono: ${t.font.mono};`);
for (const [name, s] of Object.entries(t.type)) {
  theme.push(`  --text-${name}: ${px(s.size)};`, `  --text-${name}--line-height: ${px(s.line)};`);
}
for (const [name, r] of Object.entries(t.radius)) theme.push(`  --radius-${name}: ${px(r)};`);
for (const [name, s] of Object.entries(t.shadow)) theme.push(`  --shadow-${name}: ${s};`);
theme.push(`  --ease-out: ${t.motion.ease};`);
root.push(`  --motion-fast: ${t.motion.fast};`, `  --motion-base: ${t.motion.base};`);
for (const [name, v] of Object.entries(t.layout)) {
  if (typeof v === 'number') root.push(`  --layout-${name}: ${px(v)};`);
}
for (const [name, v] of Object.entries(t.layout.breakpoints)) theme.push(`  --breakpoint-${name}: ${px(v)};`);

const css = `/* GERADO por design/build-tokens.mjs a partir de design/tokens.json — não editar à mão. */
:root {
${root.join('\n')}
}

@theme inline {
${theme.join('\n')}
}
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, css);
console.log('tokens.css gerado:', out, `(${Object.keys(t.color).length} cores)`);
