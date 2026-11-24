import type { Config } from "tailwindcss";

// Design tokens: see docs/DESIGN.md (v3: white / blue / light grey / black). Surface + semantic colors, shadows and the tab-bar height are CSS variables
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
        // Brand v3: ONE blue for everything interactive or selected (links, primary buttons, active tab / segment,
        // focus ring, chart highlight). Content is near-black, secondary text grey, surfaces white on light grey.
        brand: {
          50: "#eff5ff",
          100: "#dbe8fe",
          200: "#bed6fd",
          300: "#8fb8fb",
          400: "#5b9bf7", // dark-mode links / selected text (6:1+ on charcoal)
          500: "#2a78ee",
          600: "#0b5cd5", // THE interactive blue (6:1 on white): links, primary buttons, active states
          700: "#0849ab",
          800: "#0c3d87",
          900: "#0f3369",
          950: "#0b2045",
        },
        // Gold survives only for championship / trophy moments (champion row, trophy icons, title game)
        gold: {
          50: "#fffaeb",
          100: "#fff1c7",
          200: "#ffe48f",
          300: "#ffd666",
          400: "#ffc633",
          500: "#f5b301",
          600: "#cc9200",
          700: "#8f6700", // AA (4.6:1+) as small text on every light surface
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
        // v3: one family. `font-display` is Inter too (legacy class; globals.css also drops its uppercase).
        display: ['"Inter Variable"', "-apple-system", "BlinkMacSystemFont", '"SF Pro Display"', '"Segoe UI"', "Roboto", '"Helvetica Neue"', "Arial", "sans-serif"],
        // scoreboard numerals + slot pills only (Matchup / Roster patterns): condensed, tall, tabular
        score: ['"Barlow Condensed"', '"Inter Variable"', '"Arial Narrow"', "sans-serif"],
        mono: ["ui-monospace", '"SF Mono"', "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
        // v3 type scale (docs/DESIGN.md §3): micro-label 12 · caption 13 · body 15 · section 17 · title 24/28 · stat 28 · score 40/48
        micro: ["0.75rem", { lineHeight: "1rem", letterSpacing: "0.04em", fontWeight: "600" }],
        caption: ["0.8125rem", { lineHeight: "1.125rem" }],
        body: ["0.9375rem", { lineHeight: "1.375rem" }],
        section: ["1.0625rem", { lineHeight: "1.375rem", letterSpacing: "-0.01em", fontWeight: "700" }],
        title: ["1.5rem", { lineHeight: "1.875rem", letterSpacing: "-0.02em", fontWeight: "700" }],
        stat: ["1.75rem", { lineHeight: "2rem", letterSpacing: "-0.02em", fontWeight: "600" }],
        score: ["2.5rem", { lineHeight: "2.75rem", letterSpacing: "-0.03em", fontWeight: "600" }],
      },
      borderRadius: {
        sm: "4px",
        DEFAULT: "6px",
        md: "8px",
        lg: "10px",
        xl: "14px",
        "2xl": "16px",
        "3xl": "24px",
        control: "8px",
        card: "12px",
        sheet: "18px",
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
        // v3: no glows — kept as names only (flat hairline rings) so older markup still compiles
        "glow-live": "0 0 0 1px rgb(208 31 43 / 0.25)",
        "glow-gold": "0 0 0 1px rgb(245 179 1 / 0.35)",
      },
      spacing: {
        tabbar: "var(--tabbar-h)",
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.22, 1, 0.36, 1)",
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      keyframes: {
        flash: { "0%": { backgroundColor: "rgb(11 92 213 / 0.12)" }, "100%": { backgroundColor: "transparent" } },
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
