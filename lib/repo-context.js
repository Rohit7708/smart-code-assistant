import fs from "fs";
import path from "path";

const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
]);

const INCLUDED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".css",
  ".py",
  ".yaml",
  ".yml",
  ".txt",
]);

function normalizeText(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenize(text) {
  return normalizeText(text)
    .split(/\s+/)
    .filter(Boolean);
}

function chunkText(text, maxChunkSize = 1200) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const chunks = [];
  let current = "";

  for (const line of lines) {
    if ((current + "\n" + line).length > maxChunkSize && current) {
      chunks.push(current.trim());
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }

  if (current) {
    chunks.push(current.trim());
  }

  return chunks.filter(Boolean);
}

function buildVector(text, vocabulary, documentFrequency, totalDocuments) {
  const tokens = tokenize(text);
  const counts = new Map();

  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return vocabulary.map((term) => {
    const tf = counts.get(term) ?? 0;
    if (!tf) {
      return 0;
    }

    const df = documentFrequency.get(term) ?? 1;
    const idf = Math.log((totalDocuments + 1) / (df + 1)) + 1;
    return tf * idf;
  });
}

function cosineSimilarity(left, right) {
  if (!left.length || !right.length) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (!leftMagnitude || !rightMagnitude) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function persistVectorIndex(rootDir, chunks, vocabulary) {
  const cacheDir = path.join(rootDir, ".cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  const indexPath = path.join(cacheDir, "repo-index.json");
  const payload = {
    generatedAt: new Date().toISOString(),
    vocabulary,
    chunks,
  };

  fs.writeFileSync(indexPath, JSON.stringify(payload, null, 2));
}

export function collectRepositoryFiles(rootDir, maxFiles = 80) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const files = [];

  function walk(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) {
          continue;
        }

        walk(path.join(currentPath, entry.name));
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (!INCLUDED_EXTENSIONS.has(extension)) {
        continue;
      }

      const fullPath = path.join(currentPath, entry.name);
      const content = fs.readFileSync(fullPath, "utf8");

      if (content.length > 25000) {
        continue;
      }

      files.push({
        path: path.relative(rootDir, fullPath).replace(/\\/g, "/"),
        content,
      });

      if (files.length >= maxFiles) {
        return;
      }
    }
  }

  walk(rootDir);
  return files;
}

export function buildRepositoryIndex(rootDir, maxFiles = 80) {
  const files = collectRepositoryFiles(rootDir, maxFiles);
  const chunks = files.flatMap((file) => {
    const content = `${file.path}\n${file.content}`;
    return chunkText(content).map((chunk, index) => ({
      path: file.path,
      chunkIndex: index,
      content: chunk,
    }));
  });

  if (!chunks.length) {
    return [];
  }

  const vocabulary = Array.from(
    new Set(chunks.flatMap((chunk) => tokenize(chunk.content))),
  ).sort();

  const documentFrequency = new Map();
  for (const chunk of chunks) {
    const uniqueTokens = new Set(tokenize(chunk.content));
    for (const token of uniqueTokens) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const indexedChunks = chunks.map((chunk) => ({
    ...chunk,
    vector: buildVector(chunk.content, vocabulary, documentFrequency, chunks.length),
  }));

  persistVectorIndex(rootDir, indexedChunks, vocabulary);
  return indexedChunks;
}

export function getRelevantRepoContext(query, chunks, limit = 5) {
  const queryTerms = tokenize(query);

  if (!queryTerms.length || !chunks.length) {
    return [];
  }

  const vocabulary = Array.from(
    new Set(chunks.flatMap((chunk) => tokenize(chunk.content))),
  ).sort();

  const documentFrequency = new Map();
  for (const chunk of chunks) {
    const uniqueTokens = new Set(tokenize(chunk.content));
    for (const token of uniqueTokens) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const queryVector = buildVector(query, vocabulary, documentFrequency, chunks.length);

  return chunks
    .map((chunk) => ({
      ...chunk,
      score: cosineSimilarity(queryVector, chunk.vector ?? []),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}
