import { ImageResponse } from "next/og";

export async function GET(_req: Request, ctx: RouteContext<"/icons/[size]">) {
  const { size } = await ctx.params;
  const px = size === "512" ? 512 : 192;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#2f7d4f",
          fontSize: px * 0.55,
        }}
      >
        🥘
      </div>
    ),
    { width: px, height: px },
  );
}
