/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#f3f1f4",
        foreground: "#19191b",
        border: "#e6d9fd",
        input: "#e6d9fd",
        ring: "#ac82f7",
        warm: "#cea997",
        card: {
          DEFAULT: "#ffffff",
          foreground: "#19191b",
        },
        popover: {
          DEFAULT: "#ffffff",
          foreground: "#19191b",
        },
        primary: {
          DEFAULT: "#ac82f7",
          foreground: "#ffffff",
          light: "#bca1f8",
          lighter: "#d4c0fb",
          pale: "#e6d9fd",
        },
        secondary: {
          DEFAULT: "#e6d9fd",
          foreground: "#19191b",
        },
        muted: {
          DEFAULT: "#f3f1f4",
          foreground: "#5b5553",
        },
        accent: {
          DEFAULT: "#d4c0fb",
          foreground: "#19191b",
        },
        destructive: {
          DEFAULT: "#cea997",
          foreground: "#19191b",
        },
        sidebar: {
          DEFAULT: "#ffffff",
          foreground: "#19191b",
          primary: "#ac82f7",
          "primary-foreground": "#ffffff",
          accent: "#e6d9fd",
          "accent-foreground": "#19191b",
          border: "#e6d9fd",
          ring: "#ac82f7",
        },
      },
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "20px",
        "2xl": "24px",
        "3xl": "28px",
      },
      fontFamily: {
        sans: ["Plus Jakarta Sans", "Helvetica Neue", "system-ui", "sans-serif"],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
