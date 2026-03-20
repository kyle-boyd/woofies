import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        alpine: {
          50:  "#f0faf8",
          100: "#e0f4f1",
          300: "#5bbdac",
          400: "#4db8a5",
          500: "#3a9e8c",
          600: "#2d8374",
          700: "#246f61",
          800: "#1d5c51",
          900: "#1a5449",
        },
      },
    },
  },
  plugins: [],
};

export default config;
