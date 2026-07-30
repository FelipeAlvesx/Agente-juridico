import type { Config } from 'tailwindcss'

/**
 * Identidade Juris — cartório moderno, não clínica.
 * Navy de tinta + latão. Fundo papel, nunca branco puro na moldura.
 *
 * As cores de SÉRIE dos gráficos não moram aqui — ficam em src/lib/theme.ts,
 * validadas para daltonismo. Aqui é só a cromática de interface.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#141E33',   // sidebar e superfícies escuras
          soft:    '#1E2C48',
          line:    '#2A3A5C',
        },
        primary: {
          DEFAULT: '#1E3A63',
          light:   '#2E5FA3',
          dark:    '#12233D',
        },
        brass: {
          DEFAULT: '#B07C1E',   // acento: seleção, destaque, "precisa de atenção"
          light:   '#D6B06A',
          pale:    '#F5EAD4',
        },
        surface:     '#FFFFFF',
        'surface-2': '#FAF8F4',
        bg:          '#F3F1EC',
        line:        '#E7E3DA',
      },
      fontFamily: {
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
      // Véus de cor abaixo de 20% — a paleta é sóbria e vive nesses degraus.
      opacity: {
        8: '0.08', 12: '0.12', 15: '0.15', 18: '0.18',
        35: '0.35', 45: '0.45', 55: '0.55', 65: '0.65', 85: '0.85',
      },
      borderRadius: {
        '2xl': '1rem',
      },
      boxShadow: {
        card:  '0 1px 2px rgba(20,30,51,0.04), 0 1px 3px rgba(20,30,51,0.03)',
        lift:  '0 8px 24px -8px rgba(20,30,51,0.16), 0 2px 6px rgba(20,30,51,0.05)',
        panel: '0 24px 60px -18px rgba(20,30,51,0.32)',
      },
    },
  },
  plugins: [],
} satisfies Config
