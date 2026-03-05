export interface LocalAddressInput {
  postalCode: string;
  prefecture: string;
  city: string;
  town: string;
  ooaza: string;
  aza: string;
  koaza: string;
  banchi: string;
  building: string;
}

export interface LocalAddressCandidate {
  postalCode: string;
  prefecture: string;
  city: string;
  town: string;
}

export interface LocalAddressCorrection {
  postalCode: string;
  prefecture: string;
  city: string;
  town: string;
}

export interface LocalAddressCheckResult {
  isValidAddress: boolean;
  reason: string;
  confidence: number;
  corrected: LocalAddressCorrection | null;
}

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
  response?: string;
}

const clampConfidence = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
};

const pickString = (value: unknown): string => {
  return typeof value === "string" ? value.trim() : "";
};

const extractJsonBlock = (rawText: string): string => {
  const text = rawText.trim();
  if (!text) {
    throw new Error("ローカルLLMの応答が空です。");
  }
  if (text.startsWith("{") && text.endsWith("}")) {
    return text;
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("ローカルLLMの応答からJSONを抽出できませんでした。");
  }
  return text.slice(start, end + 1);
};

const parseResult = (rawContent: string): LocalAddressCheckResult => {
  const jsonBlock = extractJsonBlock(rawContent);
  const parsed = JSON.parse(jsonBlock) as Record<string, unknown>;

  const rawCorrection =
    parsed.corrected && typeof parsed.corrected === "object"
      ? (parsed.corrected as Record<string, unknown>)
      : null;
  const corrected =
    rawCorrection &&
    (pickString(rawCorrection.prefecture) ||
      pickString(rawCorrection.city) ||
      pickString(rawCorrection.town) ||
      pickString(rawCorrection.postalCode))
      ? {
          postalCode: pickString(rawCorrection.postalCode),
          prefecture: pickString(rawCorrection.prefecture),
          city: pickString(rawCorrection.city),
          town: pickString(rawCorrection.town),
        }
      : null;

  return {
    isValidAddress: Boolean(parsed.isValidAddress),
    reason: pickString(parsed.reason) || "判定理由が返されませんでした。",
    confidence: clampConfidence(parsed.confidence),
    corrected,
  };
};

const buildPrompt = (
  input: LocalAddressInput,
  candidates: LocalAddressCandidate[]
): string => {
  const manualAddress = [
    input.prefecture,
    input.city,
    input.town,
    input.ooaza,
    input.aza,
    input.koaza,
    input.banchi,
    input.building,
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("");

  return [
    "あなたは日本住所データ品質チェッカーです。",
    "手入力住所を判定し、誤りの可能性がある場合は修正候補を返してください。",
    "住所候補リストは参考情報です。候補に存在しない時は corrected を null にしてください。",
    "必ずJSONのみで回答してください。説明文は禁止です。",
    "",
    "出力JSONスキーマ:",
    "{",
    '  "isValidAddress": boolean,',
    '  "reason": string,',
    '  "confidence": number,',
    '  "corrected": {',
    '    "postalCode": string,',
    '    "prefecture": string,',
    '    "city": string,',
    '    "town": string',
    "  } | null",
    "}",
    "",
    "判定対象（手入力値）:",
    JSON.stringify(
      {
        postalCode: input.postalCode,
        manualAddress,
        fields: {
          prefecture: input.prefecture,
          city: input.city,
          town: input.town,
          ooaza: input.ooaza,
          aza: input.aza,
          koaza: input.koaza,
          banchi: input.banchi,
          building: input.building,
        },
      },
      null,
      2
    ),
    "",
    "参考候補（KEN_ALL由来・最大8件）:",
    JSON.stringify(candidates, null, 2),
  ].join("\n");
};

export const checkAddressWithLocalLlm = async (params: {
  endpoint: string;
  model: string;
  input: LocalAddressInput;
  candidates: LocalAddressCandidate[];
  timeoutMs?: number;
}): Promise<LocalAddressCheckResult> => {
  const endpoint = params.endpoint.trim();
  const model = params.model.trim();
  if (!endpoint) {
    throw new Error("ローカルLLMエンドポイントが未設定です。");
  }
  if (!model) {
    throw new Error("ローカルLLMモデル名が未設定です。");
  }

  const controller = new AbortController();
  const timeoutMs = params.timeoutMs ?? 30000;
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const prompt = buildPrompt(params.input, params.candidates);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        options: {
          temperature: 0.1,
        },
        messages: [
          {
            role: "system",
            content:
              "あなたは日本の住所正規化と誤記修正を行うアシスタントです。必ずJSONのみで回答してください。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `ローカルLLM呼び出しに失敗しました (${response.status} ${response.statusText})`
      );
    }

    const body = (await response.json()) as OllamaChatResponse;
    const content =
      (typeof body.message?.content === "string" ? body.message.content : "").trim() ||
      (typeof body.response === "string" ? body.response : "").trim();
    if (!content) {
      throw new Error("ローカルLLMから本文応答を取得できませんでした。");
    }

    return parseResult(content);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("ローカルLLMの応答がタイムアウトしました。");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};
