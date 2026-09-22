import type { Plugin } from "vite";

const DISPLAY_FONT = /fraunces-latin-wght-normal[^/]*\.woff2$/;

export function fontPreload(): Plugin {
  return {
    name: "cube:font-preload",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        const file = Object.keys(ctx.bundle ?? {}).find((name) => DISPLAY_FONT.test(name));
        if (!file) return [];
        return [
          {
            tag: "link",
            attrs: {
              rel: "preload",
              href: `/${file}`,
              as: "font",
              type: "font/woff2",
              crossorigin: "",
            },
            injectTo: "head",
          },
        ];
      },
    },
  };
}
