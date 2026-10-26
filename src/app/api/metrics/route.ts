import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  if (!token) {
    return NextResponse.json({ error: "Informe o token de métricas." }, { status: 400 });
  }

  const baseUrl = process.env.BACKEND_API_URL?.trim() || "http://localhost:8080";

  try {
    const upstream = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/admin/metrics`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });

    if (upstream.status === 404 || upstream.status === 401 || upstream.status === 403) {
      return NextResponse.json({ error: "Token inválido ou sem acesso às métricas." }, { status: 401 });
    }

    if (!upstream.ok) {
      return NextResponse.json({ error: "A API não conseguiu consultar as métricas." }, { status: 502 });
    }

    return NextResponse.json(await upstream.json(), {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível conectar à API. Verifique o endereço e tente novamente." },
      { status: 502 },
    );
  }
}
