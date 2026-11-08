/* Visual themes. The ids are internal; people see the labels. */
export const THEMES = [
  { id: 'midnight', en: 'Midnight', es: 'Medianoche', sw: ['#07070B', '#7C3AED', '#FF5E1A'], meta: '#07070B' },
  { id: 'blossom', en: 'Blossom', es: 'Cerezo', sw: ['#FFF6F8', '#F472B6', '#B892F5'], meta: '#FFF6F8' },
  { id: 'slate', en: 'Slate', es: 'Pizarra', sw: ['#0C1015', '#7FB8DB', '#F5A524'], meta: '#0C1015' },
  { id: 'paper', en: 'Paper', es: 'Papel', sw: ['#F7F6F2', '#161616', '#FF4F1F'], meta: '#F7F6F2' },
];
export let THEME = 'midnight';
export function setTheme(id) {
  const th = THEMES.find((x) => x.id === id) || THEMES[0];
  THEME = th.id;
  document.documentElement.dataset.theme = th.id;
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = th.meta;
  try { localStorage.setItem('wwm.theme', th.id); } catch (e) {}
}
try { setTheme(localStorage.getItem('wwm.theme') || 'midnight'); } catch (e) { setTheme('midnight'); }
export const themeName = (th, lang) => (lang === 'es' ? th.es : th.en);
export const swatchHTML = (th) => `<span class="tsw">${th.sw.map((c) => `<i style="background:${c}"></i>`).join('')}</span>`;
