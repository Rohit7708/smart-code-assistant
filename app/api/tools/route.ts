import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

function listDirectory(targetPath: string, maxItems = 50) {
  if (!fs.existsSync(targetPath)) {
    return [];
  }

  const entries = fs.readdirSync(targetPath, { withFileTypes: true });
  return entries
    .slice(0, maxItems)
    .map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
    }));
}

function readFile(targetPath: string) {
  if (!fs.existsSync(targetPath)) {
    return null;
  }

  const content = fs.readFileSync(targetPath, "utf8");
  return content.slice(0, 8000);
}

export async function POST(request: NextRequest) {
  try {
    const { action, targetPath } = await request.json();

    if (!targetPath) {
      return NextResponse.json({ error: "Missing targetPath." }, { status: 400 });
    }

    const absoluteTarget = path.resolve(process.cwd(), targetPath);

    switch (action) {
      case "listDirectory":
        return NextResponse.json({ entries: listDirectory(absoluteTarget) });
      case "readFile": {
        const content = readFile(absoluteTarget);
        if (content === null) {
          return NextResponse.json({ error: "File not found." }, { status: 404 });
        }
        return NextResponse.json({ content });
      }
      default:
        return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error.",
      },
      { status: 500 },
    );
  }
}
