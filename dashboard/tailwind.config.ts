import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#7C3D6E',
          light:   '#9B5089',
          dark:    '#5E2D53',
        },
        gold: {
          DEFAULT: '#C5A87D',
          light:   '#D4BB99',
        },
        surface:   '#FFFFFF',
        'surface-2': '#FAFAF8',
        bg:        '#F0EFEC',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '1rem',
      },
    },
  },
  plugins: [],
} satisfies Config
