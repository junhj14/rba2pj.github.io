import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const DB_DIR = path.join(process.cwd(), "database");

function filePath(id: string) {
  return path.join(DB_DIR, `${id}.json`);
}

// 단건 조회: GET /api/boards/:id
export async function GET(_: NextRequest, { params }: { params: { id: string }}) {
  try {
    const data = await fs.readFile(filePath(params.id), "utf8");
    return new NextResponse(data, { headers: { "content-type": "application/json" } });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

// 삭제: DELETE /api/boards/:id
export async function DELETE(_: NextRequest, { params }: { params: { id: string }}) {
  try {
    await fs.unlink(filePath(params.id));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
