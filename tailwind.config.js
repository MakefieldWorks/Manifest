/** @type {import('tailwindcss').Config} */

// The renderer still uses Tailwind's familiar palette utilities, but those
// utilities now resolve by *role* rather than to fixed colors. Keeping this
// compatibility layer lets a theme swap all surfaces, text, borders, and
// semantic states without scattering `dark:` variants through components.
const token = (name) => `rgb(var(--theme-${name}) / <alpha-value>)`

// Legacy Tailwind shades remain a compatibility surface. They intentionally
// resolve to the smaller set of semantic contrast roles instead of creating
// theme tokens for every raw palette step.

export default {
  content: ['./src/renderer/**/*.{html,js,ts,svelte}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Menlo', 'monospace'],
      },
      backgroundColor: {
        white: token('surface-raised'),
        stone: {
          50: token('surface-recessed'),
          100: token('surface-hairline'),
          200: token('surface-selected'),
          300: token('surface-disabled'),
          700: token('control-primary-hover'),
          800: token('control-primary'),
        },
        amber: {
          50: token('attention-wash'),
          100: token('attention-tint'),
          200: token('attention-edge'),
          500: token('attention-fill'),
        },
        emerald: {
          50: token('success-wash'),
          100: token('success-tint'),
        },
        red: {
          50: token('danger-wash'),
          100: token('danger-tint'),
          700: token('danger-fill'),
        },
        sky: {
          50: token('info-wash'),
          100: token('info-tint'),
          400: token('info-signal'),
          500: token('info-fill'),
        },
        violet: {
          50: token('violet-wash'),
          100: token('violet-tint'),
        },
        purple: {
          50: token('purple-wash'),
        },
        indigo: {
          100: token('indigo-tint'),
        },
        slate: {
          100: token('slate-tint'),
        },
      },
      textColor: {
        white: token('text-on-primary'),
        stone: {
          300: token('text-disabled'),
          400: token('text-faint'),
          500: token('text-muted'),
          600: token('text-secondary'),
          700: token('text-body'),
          800: token('text-strong'),
          900: token('text-primary'),
        },
        amber: {
          600: token('attention-ink-soft'),
          700: token('attention-ink'),
          800: token('attention-ink-strong'),
          900: token('attention-ink-deep'),
        },
        emerald: {
          600: token('success-ink-soft'),
          700: token('success-ink'),
          800: token('success-ink-strong'),
          900: token('success-ink-deep'),
        },
        red: {
          400: token('danger-ink-soft'),
          600: token('danger-ink'),
          700: token('danger-ink-strong'),
          800: token('danger-ink-deep'),
        },
        sky: {
          500: token('info-ink-soft'),
          600: token('info-ink'),
          700: token('info-ink'),
          800: token('info-ink-strong'),
          900: token('info-ink-deep'),
        },
        violet: {
          700: token('violet-ink'),
          800: token('violet-ink-deep'),
        },
        purple: {
          900: token('purple-ink-deep'),
        },
        indigo: {
          700: token('indigo-ink'),
        },
        slate: {
          600: token('slate-ink'),
        },
      },
      borderColor: {
        stone: {
          100: token('border-subtle'),
          200: token('border-default'),
          300: token('border-strong'),
          500: token('border-emphasis'),
          700: token('border-inverse'),
        },
        amber: {
          100: token('attention-tint'),
          200: token('attention-edge'),
          300: token('attention-edge-strong'),
          400: token('attention-signal'),
        },
        emerald: {
          200: token('success-edge'),
        },
        red: {
          200: token('danger-edge'),
          300: token('danger-edge-strong'),
        },
        sky: {
          200: token('info-edge'),
        },
        violet: {
          200: token('violet-edge'),
        },
        slate: {
          200: token('slate-edge'),
        },
      },
      divideColor: {
        stone: {
          100: token('border-subtle'),
        },
      },
      ringColor: {
        stone: {
          200: token('focus-soft'),
          300: token('focus'),
          400: token('focus-strong'),
        },
        amber: {
          300: token('attention-edge-strong'),
          400: token('attention-signal'),
        },
        emerald: {
          100: token('success-tint'),
        },
        red: {
          300: token('danger-edge-strong'),
        },
        sky: {
          300: token('info-edge-strong'),
          400: token('info-signal'),
          500: token('info-fill'),
        },
      },
      placeholderColor: {
        stone: {
          300: token('text-disabled'),
        },
      },
      textDecorationColor: {
        stone: {
          400: token('text-faint'),
        },
      },
    },
  },
  plugins: [],
}
