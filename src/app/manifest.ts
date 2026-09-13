import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MealPrep",
    short_name: "MealPrep",
    description: "Pantry, freezer, recipes and a shopping list that writes itself.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f5f0",
    theme_color: "#2f7d4f",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
