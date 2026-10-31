/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#4F46E5',
          dark: '#4338CA',
          light: '#818CF8',
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
