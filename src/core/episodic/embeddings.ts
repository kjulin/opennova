import fs from "fs";
import path from "path";
import { Config } from "../config.js";
import { log } from "../logger.js";

// Lazy-loaded singleton session
let sessionPromise: Promise<OnnxSession> | null = null;
let tokenizer: Tokenizer | null = null;

const MAX_SEQUENCE_LENGTH = 256;
const EMBEDDING_DIM = 384;

// --- Tokenizer types ---

interface TokenizerJson {
  model: {
    vocab: Record<string, number>;
  };
  added_tokens: Array<{ id: number; content: string }>;
}

interface Tokenizer {
  vocab: Record<string, number>;
  idToToken: Map<number, string>;
  clsId: number;
  sepId: number;
  unkId: number;
  padId: number;
}

// --- ONNX types (minimal interface to avoid importing onnxruntime at top-level) ---

interface OnnxSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array | BigInt64Array; dims: number[] }>>;
}

interface OnnxTensor {
  new (data: BigInt64Array | Float32Array, dims: number[]): unknown;
}

function getModelsDir(): string {
  return path.join(Config.workspaceDir, "models");
}

function getModelPath(): string {
  return path.join(getModelsDir(), "all-MiniLM-L6-v2.onnx");
}

function getTokenizerPath(): string {
  return path.join(getModelsDir(), "tokenizer.json");
}

// --- Tokenizer ---

function loadTokenizer(): Tokenizer {
  if (tokenizer) return tokenizer;

  const tokenizerPath = getTokenizerPath();
  if (!fs.existsSync(tokenizerPath)) {
    throw new Error(`Tokenizer not found at ${tokenizerPath}. Run 'nova init' first.`);
  }

  const raw = JSON.parse(fs.readFileSync(tokenizerPath, "utf-8")) as TokenizerJson;
  const vocab = raw.model.vocab;

  // Build reverse mapping
  const idToToken = new Map<number, string>();
  for (const [token, id] of Object.entries(vocab)) {
    idToToken.set(id, token);
  }

  // Add special tokens from added_tokens
  for (const added of raw.added_tokens) {
    vocab[added.content] = added.id;
    idToToken.set(added.id, added.content);
  }

  const clsId = vocab["[CLS]"];
  const sepId = vocab["[SEP]"];
  const unkId = vocab["[UNK]"];
  const padId = vocab["[PAD]"];

  if (clsId === undefined || sepId === undefined || unkId === undefined || padId === undefined) {
    throw new Error("Tokenizer missing required special tokens ([CLS], [SEP], [UNK], [PAD])");
  }

  tokenizer = { vocab, idToToken, clsId, sepId, unkId, padId };
  return tokenizer;
}

/**
 * Basic WordPiece tokenization matching the all-MiniLM-L6-v2 tokenizer.
 * Lowercases input, splits on whitespace and punctuation, then applies WordPiece.
 */
function wordPieceTokenize(text: string, tok: Tokenizer): number[] {
  // Lowercase and normalize whitespace
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();

  // Basic pre-tokenization: split on spaces and punctuation boundaries
  const words: string[] = [];
  let current = "";
  for (const ch of normalized) {
    if (ch === " ") {
      if (current) words.push(current);
      current = "";
    } else if (/[^\w]/.test(ch)) {
      if (current) words.push(current);
      words.push(ch);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) words.push(current);

  const tokenIds: number[] = [];

  for (const word of words) {
    let remaining = word;
    let isFirst = true;

    while (remaining.length > 0) {
      let found = false;

      // Try to find the longest matching subword
      for (let end = remaining.length; end > 0; end--) {
        const subword = isFirst ? remaining.slice(0, end) : `##${remaining.slice(0, end)}`;
        const id = tok.vocab[subword];
        if (id !== undefined) {
          tokenIds.push(id);
          remaining = remaining.slice(end);
          isFirst = false;
          found = true;
          break;
        }
      }

      if (!found) {
        // Character not in vocab — use [UNK] for the whole remaining word
        tokenIds.push(tok.unkId);
        break;
      }
    }
  }

  return tokenIds;
}

function tokenize(text: string): { inputIds: bigint[]; attentionMask: bigint[]; tokenTypeIds: bigint[] } {
  const tok = loadTokenizer();
  let wordPieceIds = wordPieceTokenize(text, tok);

  // Truncate to MAX_SEQUENCE_LENGTH - 2 (for [CLS] and [SEP])
  if (wordPieceIds.length > MAX_SEQUENCE_LENGTH - 2) {
    wordPieceIds = wordPieceIds.slice(0, MAX_SEQUENCE_LENGTH - 2);
  }

  // Build final sequence: [CLS] + tokens + [SEP]
  const inputIds = [BigInt(tok.clsId), ...wordPieceIds.map(BigInt), BigInt(tok.sepId)];
  const attentionMask = inputIds.map(() => 1n);
  const tokenTypeIds = inputIds.map(() => 0n);

  return { inputIds, attentionMask, tokenTypeIds };
}

// --- ONNX Model ---

async function getSession(): Promise<OnnxSession> {
  if (!sessionPromise) {
    sessionPromise = loadSession();
  }
  return sessionPromise;
}

async function loadSession(): Promise<OnnxSession> {
  const modelPath = getModelPath();
  if (!fs.existsSync(modelPath)) {
    throw new Error(`ONNX model not found at ${modelPath}. Run 'nova init' first.`);
  }

  // Dynamic import to avoid loading onnxruntime-node at startup
  const ort = await import("onnxruntime-node");
  const session = await ort.InferenceSession.create(modelPath);
  log.info("episodic", "loaded all-MiniLM-L6-v2 model");
  return session as unknown as OnnxSession;
}

function meanPooling(lastHiddenState: Float32Array, attentionMask: bigint[], seqLen: number): number[] {
  const embedding = new Array<number>(EMBEDDING_DIM).fill(0);
  let maskSum = 0;

  for (let i = 0; i < seqLen; i++) {
    const mask = Number(attentionMask[i]!);
    maskSum += mask;
    for (let j = 0; j < EMBEDDING_DIM; j++) {
      embedding[j]! += lastHiddenState[i * EMBEDDING_DIM + j]! * mask;
    }
  }

  // Divide by mask sum (avoid division by zero)
  if (maskSum > 0) {
    for (let j = 0; j < EMBEDDING_DIM; j++) {
      embedding[j]! /= maskSum;
    }
  }

  return embedding;
}

function normalize(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

/**
 * Generate a 384-dimensional embedding for the given text.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const { inputIds, attentionMask, tokenTypeIds } = tokenize(text);
  const seqLen = inputIds.length;

  const session = await getSession();

  // Dynamic import for Tensor constructor
  const ort = await import("onnxruntime-node");
  const OrtTensor = ort.Tensor as unknown as OnnxTensor;

  const feeds = {
    input_ids: new OrtTensor(new BigInt64Array(inputIds), [1, seqLen]),
    attention_mask: new OrtTensor(new BigInt64Array(attentionMask), [1, seqLen]),
    token_type_ids: new OrtTensor(new BigInt64Array(tokenTypeIds), [1, seqLen]),
  };

  const results = await session.run(feeds);

  // The model output key is typically "last_hidden_state"
  const outputKey = Object.keys(results)[0]!;
  const output = results[outputKey]!;
  const lastHiddenState = output.data as Float32Array;

  const pooled = meanPooling(lastHiddenState, attentionMask, seqLen);
  return normalize(pooled);
}

/**
 * Compute cosine similarity between two unit-normalized vectors.
 * Since vectors are already normalized, this is just the dot product.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
  }
  return dot;
}

/**
 * Check if the embedding model files are present.
 */
export function isModelAvailable(): boolean {
  return fs.existsSync(getModelPath()) && fs.existsSync(getTokenizerPath());
}

/**
 * Download the all-MiniLM-L6-v2 model and tokenizer files.
 */
export async function downloadEmbeddingModel(
  onProgress?: (file: string, percent: number) => void,
): Promise<void> {
  const modelsDir = getModelsDir();
  fs.mkdirSync(modelsDir, { recursive: true });

  const files = [
    {
      name: "model_quantized.onnx",
      url: "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_quantized.onnx",
      dest: getModelPath(),
    },
    {
      name: "tokenizer.json",
      url: "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/tokenizer.json",
      dest: getTokenizerPath(),
    },
  ];

  for (const file of files) {
    if (fs.existsSync(file.dest)) {
      log.info("episodic", `${file.name} already exists, skipping`);
      continue;
    }

    log.info("episodic", `downloading ${file.name}...`);

    const response = await fetch(file.url);
    if (!response.ok) {
      throw new Error(`Failed to download ${file.name}: ${response.statusText}`);
    }

    const contentLength = parseInt(response.headers.get("content-length") ?? "0");
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error(`Failed to read response body for ${file.name}`);
    }

    const tempPath = `${file.dest}.tmp`;
    const writeStream = fs.createWriteStream(tempPath);
    let receivedLength = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        writeStream.write(value);
        receivedLength += value.length;

        if (contentLength > 0 && onProgress) {
          onProgress(file.name, Math.round((receivedLength / contentLength) * 100));
        }
      }

      await new Promise<void>((resolve, reject) => {
        writeStream.end(() => resolve());
        writeStream.on("error", reject);
      });

      fs.renameSync(tempPath, file.dest);
    } catch (err) {
      try { fs.unlinkSync(tempPath); } catch {}
      throw err;
    }

    log.info("episodic", `saved ${file.name}`);
  }
}
