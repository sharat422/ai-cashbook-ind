/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#2563EB',
          dark: '#1D4ED8',
          light: '#60A5FA',
        },
        surface: '#FFFFFF',
        background: '#F8FAFC',
        muted: '#64748B',
        border: '#E2E8F0',
        danger: '#DC2626',
        success: '#16A34A',
      },
    },
  },
  plugins: [],
};
