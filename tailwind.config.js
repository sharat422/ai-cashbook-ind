/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // The Bolcash logo's orange (#D76901), deepened so white text on it
        // and it as text on the background stay readable (≥ 4.5:1).
        primary: {
          DEFAULT: '#B05500',
          dark: '#8A4200',
          light: '#E5952A',
        },
        surface: '#FFFFFF',
        background: '#F5F6FF',
        muted: '#64748B',
        border: '#E2E8F0',
        danger: '#DC2626',
        success: '#16A34A',
      },
    },
  },
  plugins: [],
};
