import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // CSS-variable driven surface colors (light + dark themes in globals.css)
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        panel: "rgb(var(--c-panel) / <alpha-value>)",
        sunken: "rgb(var(--c-sunken) / <alpha-value>)",
        line: "rgb(var(--c-line) / <alpha-value>)",
        ink: "rgb(var(--c-ink) / <alpha-value>)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
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
          300: "#ffd666",
          400: "#ffc633",
          500: "#f5b301",
          600: "#cc9200",
        },
        live: "#e11d48",
        win: "#16a34a",
        loss: "#dc2626",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "Segoe UI", "Helvetica", "Arial", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 2px rgb(15 23 42 / 0.06), 0 1px 1px rgb(15 23 42 / 0.04)",
        pop: "0 10px 30px -10px rgb(15 23 42 / 0.35)",
      },
      keyframes: {
        flash: { "0%": { backgroundColor: "rgb(245 179 1 / 0.45)" }, "100%": { backgroundColor: "transparent" } },
        pulseDot: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.35" } },
      },
      animation: {
        flash: "flash 1.6s ease-out",
        pulseDot: "pulseDot 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
