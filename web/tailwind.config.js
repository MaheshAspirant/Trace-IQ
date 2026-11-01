/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#f5f6f8',
        surface: '#ffffff',
        sidebar: '#0d1526',
        sidebarHover: '#172033',
        ink: '#0f172a',
        muted: '#64748b',
        faint: '#94a3b8',
        line: '#e5e7eb',
        accent: {
          DEFAULT: '#2f6fed',
          soft: '#eef3ff',
          strong: '#1d4ed8',
        },
        success: { DEFAULT: '#0f9d58', soft: '#e9f7ef' },
        warning: { DEFAULT: '#c77700', soft: '#fdf3e2' },
        danger: { DEFAULT: '#d92d20', soft: '#fdecea' },
        info: { DEFAULT: '#2563eb', soft: '#eaf1ff' },
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['11px', '16px'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06)',
        pop: '0 12px 32px rgba(15, 23, 42, 0.14), 0 2px 8px rgba(15, 23, 42, 0.08)',
      },
      borderRadius: {
        xl: '12px',
        '2xl': '16px',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
        'slide-up': 'slide-up 180ms ease-out',
        shimmer: 'shimmer 1.4s infinite',
      },
    },
  },
  plugins: [],
}
