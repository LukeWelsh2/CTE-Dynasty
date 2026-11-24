import type { Config } from "tailwindcss";

// Design tokens: see docs/DESIGN.md. Surface + semantic colors, shadows and the tab-bar height are CSS variables
// (src/app/globals.css) so light and dark themes share the same class names.
//
// CommonJS on purpose (`module.exports`, types via `satisfies`): Node 22 loads an ESM-syntax .ts config through
// require(esm), whose cache Tailwind cannot clear, so a running `next dev` would never pick up edits to this file.
const config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  // No glass: the refresh uses solid surfaces only, so blur utilities are switched off app-wide.
  corePlugins: { backdropBlur: false },
  theme: {
    extend: {
      colors: {
        // CSS-variable driven surface colors (light + dark themes in globals.css)
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        panel: "rgb(var(--c-panel) / <alpha-value>)",
        raised: "rgb(var(--c-raised) / <alpha-value>)",
        sunken: "rgb(var(--c-sunken) / <alpha-value>)",
        line: "rgb(var(--c-line) / <alpha-value>)",
        ink: "rgb(var(--c-ink) / <alpha-value>)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
        faint: "rgb(var(--c-faint) / <alpha-value>)",
        chrome: "rgb(var(--c-chrome) / <alpha-value>)",
        // Brand: deep navy + championship gold
        brand: {
          50: "#eef4ff",
          100: "#d9e6ff",
          200: "#b9d0ff",
          300: "#8ab1fb",
          400: "#5b8cf3",
          500: "#3a6ae6",
          600: "#2750c9",
          700: "#1f3fa1",
          800: "#163070",
          900: "#0d2148",
          950: "#081530",
        },
        gold: {
          50: "#fffaeb",
          100: "#fff1c7",
          200: "#ffe48f",
          300: "#ffd666",
          400: "#ffc633",
          500: "#f5b301",
          600: "#cc9200",
          700: "#946a00",
          800: "#6e4f00",
          900: "#4a3500",
        },
        // semantic, slightly brighter in dark mode
        live: "rgb(var(--c-live) / <alpha-value>)",
        win: "rgb(var(--c-win) / <alpha-value>)",
        loss: "rgb(var(--c-loss) / <alpha-value>)",
      },
      fontFamily: {
        sans: ['"Inter Variable"', "-apple-system", "BlinkMacSystemFont", '"SF Pro Text"', '"Segoe UI"', "Roboto", '"Helvetica Neue"', "Arial", "sans-serif"],
        display: ['"Barlow Condensed"', '"Arial Narrow"', '"Inter Variable"', "-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "sans-serif"],
        mono: ["ui-monospace", '"SF Mono"', "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      borderRadius: {
        sm: "4px",
        DEFAULT: "6px",
        md: "8px",
        lg: "12px",
        xl: "16px",
        "2xl": "20px",
        "3xl": "28px",
        control: "10px",
        card: "16px",
        sheet: "22px",
      },
      boxShadow: {
        // values live in globals.css so dark mode can swap drop shadows for hairline highlights
        panel: "var(--shadow-panel)",
        card: "var(--shadow-card)",
        raised: "var(--shadow-raised)",
        pop: "var(--shadow-pop)",
        btn: "var(--shadow-btn)",
        "bar-top": "var(--shadow-bar-top)",
        "bar-bottom": "var(--shadow-bar-bottom)",
        "glow-live": "0 0 0 3px rgb(225 29 72 / 0.18), 0 0 14px rgb(225 29 72 / 0.45)",
        "glow-gold": "0 0 0 3px rgb(245 179 1 / 0.18), 0 0 16px rgb(245 179 1 / 0.4)",
      },
      spacing: {
        tabbar: "var(--tabbar-h)",
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.22, 1, 0.36, 1)",
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      keyframes: {
        flash: { "0%": { backgroundColor: "rgb(245 179 1 / 0.3)" }, "100%": { backgroundColor: "transparent" } },
        pulseDot: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.35" } },
        scorePop: { "0%": { transform: "scale(1)" }, "30%": { transform: "scale(1.06)" }, "100%": { transform: "scale(1)" } },
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        rise: { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: {
        flash: "flash 1.4s cubic-bezier(0.22, 1, 0.36, 1)",
        pulseDot: "pulseDot 1.4s ease-in-out infinite",
        "score-pop": "scorePop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
        "fade-in": "fadeIn 0.2s ease-out",
        rise: "rise 0.3s cubic-bezier(0.22, 1, 0.36, 1) both",
      },
    },
  },
  plugins: [],
} satisfies Config;

module.exports = config;
