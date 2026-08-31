import {
  // 型
  ValidationError,
  // 定数
  MAX_S3_KEY_BYTES,
  MAX_S3_OBJECT_SIZE,
  FORBIDDEN_KEY_CHARS,
  PATH_TRAVERSAL_PATTERN,
  EXT_TO_CONTENT_TYPE,
  SUPPORTED_EXTENSIONS,
  VALID_PRIORITIES,
  // S3 キー
  isNonEmptyKey,
  isWithinKeyByteLimit,
  hasNoForbiddenChars,
  hasNoPathTraversal,
  getExtension,
  isSupportedExtension,
  inferContentType,
  validateS3Key,
  // ファイルサイズ
  isValidFileSize,
  validateFileSize,
  // エンリッチメント入力
  validateEnricherInput,
  // エンリッチメント出力
  isValidPriority,
  validateEnricherOutput,
  // 整合性
  validateInputOutputConsistency,
  // ユーティリティ
  hasErrors,
  formatErrors,
} from "./validators";

import type { EnricherOutput } from "./types";

// ── テストヘルパー ────────────────────────────────────────────

function errorsOnly(errors: ValidationError[]): ValidationError[] {
  return errors.filter((e) => e.severity === "error");
}

function warningsOnly(errors: ValidationError[]): ValidationError[] {
  return errors.filter((e) => e.severity === "warning");
}

// ── 定数 ─────────────────────────────────────────────────────

describe("定数", () => {
  test("MAX_S3_KEY_BYTES は 1024", () => {
    expect(MAX_S3_KEY_BYTES).toBe(1024);
  });

  test("MAX_S3_OBJECT_SIZE は 5TB", () => {
    expect(MAX_S3_OBJECT_SIZE).toBe(5 * 1024 * 1024 * 1024 * 1024);
  });

  test("SUPPORTED_EXTENSIONS は 7 種類", () => {
    expect(SUPPORTED_EXTENSIONS).toHaveLength(7);
    expect(SUPPORTED_EXTENSIONS).toContain("csv");
    expect(SUPPORTED_EXTENSIONS).toContain("json");
  });

  test("VALID_PRIORITIES は high と normal", () => {
    expect(VALID_PRIORITIES).toContain("high");
    expect(VALID_PRIORITIES).toContain("normal");
    expect(VALID_PRIORITIES).toHaveLength(2);
  });

  test("EXT_TO_CONTENT_TYPE は csv を含む", () => {
    expect(EXT_TO_CONTENT_TYPE["csv"]).toBe("text/csv");
    expect(EXT_TO_CONTENT_TYPE["json"]).toBe("application/json");
  });
});

// ── isNonEmptyKey ────────────────────────────────────────────

describe("isNonEmptyKey", () => {
  test("通常のキーは true", () => {
    expect(isNonEmptyKey("data/file.csv")).toBe(true);
  });

  test("空文字は false", () => {
    expect(isNonEmptyKey("")).toBe(false);
  });

  test("空白のみは false", () => {
    expect(isNonEmptyKey("   ")).toBe(false);
  });
});

// ── isWithinKeyByteLimit ─────────────────────────────────────

describe("isWithinKeyByteLimit", () => {
  test("短いキーは true", () => {
    expect(isWithinKeyByteLimit("data/test.csv")).toBe(true);
  });

  test("1024 バイトちょうどは true", () => {
    expect(isWithinKeyByteLimit("a".repeat(1024))).toBe(true);
  });

  test("1025 バイトは false", () => {
    expect(isWithinKeyByteLimit("a".repeat(1025))).toBe(false);
  });

  test("日本語キー（マルチバイト）", () => {
    // あ = 3 バイト → 342 文字で 1026 バイト → false
    expect(isWithinKeyByteLimit("あ".repeat(342))).toBe(false);
    // 341 文字 = 1023 バイト → true
    expect(isWithinKeyByteLimit("あ".repeat(341))).toBe(true);
  });
});

// ── hasNoForbiddenChars ──────────────────────────────────────

describe("hasNoForbiddenChars", () => {
  test("通常キーは true", () => {
    expect(hasNoForbiddenChars("data/file.csv")).toBe(true);
  });

  test("null バイトを含むは false", () => {
    expect(hasNoForbiddenChars("data\x00file")).toBe(false);
  });

  test("タブ文字は false", () => {
    expect(hasNoForbiddenChars("data\tfile")).toBe(false);
  });

  test("日本語を含むは true", () => {
    expect(hasNoForbiddenChars("データ/ファイル.csv")).toBe(true);
  });
});

// ── hasNoPathTraversal ───────────────────────────────────────

describe("hasNoPathTraversal", () => {
  test("通常パスは true", () => {
    expect(hasNoPathTraversal("data/uploads/file.csv")).toBe(true);
  });

  test("../ を含むは false", () => {
    expect(hasNoPathTraversal("data/../secret/key")).toBe(false);
  });

  test("先頭 ../ は false", () => {
    expect(hasNoPathTraversal("../etc/passwd")).toBe(false);
  });

  test("ファイル名に .. を含むが / なしは true", () => {
    expect(hasNoPathTraversal("file..bak")).toBe(true);
  });
});

// ── getExtension ─────────────────────────────────────────────

describe("getExtension", () => {
  test("通常のファイル", () => {
    expect(getExtension("data/file.csv")).toBe("csv");
  });

  test("大文字拡張子は小文字に変換", () => {
    expect(getExtension("data/FILE.JSON")).toBe("json");
  });

  test("複数ドット", () => {
    expect(getExtension("data/file.tar.gz")).toBe("gz");
  });

  test("拡張子なし", () => {
    expect(getExtension("data/Makefile")).toBe("");
  });

  test("パスなしファイル名", () => {
    expect(getExtension("file.txt")).toBe("txt");
  });

  test("空文字", () => {
    expect(getExtension("")).toBe("");
  });

  test("ドットで終わるキー", () => {
    expect(getExtension("file.")).toBe("");
  });
});

// ── isSupportedExtension ─────────────────────────────────────

describe("isSupportedExtension", () => {
  test.each(["csv", "json", "xml", "txt", "log", "zip", "gz"])(
    '"%s" はサポート対象',
    (ext) => {
      expect(isSupportedExtension(ext)).toBe(true);
    }
  );

  test.each(["pdf", "png", "exe", "parquet", ""])(
    '"%s" はサポート対象外',
    (ext) => {
      expect(isSupportedExtension(ext)).toBe(false);
    }
  );
});

// ── inferContentType ─────────────────────────────────────────

describe("inferContentType", () => {
  test("csv → text/csv", () => {
    expect(inferContentType("data/file.csv")).toBe("text/csv");
  });

  test("json → application/json", () => {
    expect(inferContentType("data/file.json")).toBe("application/json");
  });

  test("gz → application/gzip", () => {
    expect(inferContentType("data/file.tar.gz")).toBe("application/gzip");
  });

  test("jpg → image/jpeg", () => {
    expect(inferContentType("photo.jpg")).toBe("image/jpeg");
  });

  test("拡張子なし → application/octet-stream", () => {
    expect(inferContentType("Makefile")).toBe("application/octet-stream");
  });

  test("未知の拡張子 → application/octet-stream", () => {
    expect(inferContentType("file.xyz")).toBe("application/octet-stream");
  });
});

// ── validateS3Key ────────────────────────────────────────────

describe("validateS3Key", () => {
  test("正常なキーはエラーなし", () => {
    expect(validateS3Key("data/uploads/file.csv")).toHaveLength(0);
  });

  test("空文字は error", () => {
    const result = errorsOnly(validateS3Key(""));
    expect(result).toHaveLength(1);
    expect(result[0].field).toBe("key");
  });

  test("パストラバーサルは error", () => {
    const result = errorsOnly(validateS3Key("data/../secret.txt"));
    expect(result.some((e) => e.message.includes("パストラバーサル"))).toBe(
      true
    );
  });

  test("制御文字は error", () => {
    const result = errorsOnly(validateS3Key("data\x00file.csv"));
    expect(result.some((e) => e.message.includes("制御文字"))).toBe(true);
  });

  test("/ で始まるキーは warning", () => {
    const result = warningsOnly(validateS3Key("/data/file.csv"));
    expect(result.some((e) => e.message.includes("/ で始め"))).toBe(true);
  });

  test("/ で終わるキーは warning", () => {
    const result = warningsOnly(validateS3Key("data/folder/"));
    expect(result.some((e) => e.message.includes("/ で終わ"))).toBe(true);
  });

  test("未サポート拡張子は warning", () => {
    const result = warningsOnly(validateS3Key("data/image.bmp"));
    expect(result.some((e) => e.message.includes("未サポートの拡張子"))).toBe(
      true
    );
  });

  test("サポート拡張子は warning なし（拡張子関連）", () => {
    const result = warningsOnly(validateS3Key("data/file.json"));
    expect(result.every((e) => !e.message.includes("拡張子"))).toBe(true);
  });
});

// ── isValidFileSize ──────────────────────────────────────────

describe("isValidFileSize", () => {
  test("0 は有効", () => {
    expect(isValidFileSize(0)).toBe(true);
  });

  test("1MB は有効", () => {
    expect(isValidFileSize(1_000_000)).toBe(true);
  });

  test("5TB は有効", () => {
    expect(isValidFileSize(MAX_S3_OBJECT_SIZE)).toBe(true);
  });

  test("負の値は無効", () => {
    expect(isValidFileSize(-1)).toBe(false);
  });

  test("5TB 超は無効", () => {
    expect(isValidFileSize(MAX_S3_OBJECT_SIZE + 1)).toBe(false);
  });

  test("NaN は無効", () => {
    expect(isValidFileSize(NaN)).toBe(false);
  });

  test("Infinity は無効", () => {
    expect(isValidFileSize(Infinity)).toBe(false);
  });
});

// ── validateFileSize ─────────────────────────────────────────

describe("validateFileSize", () => {
  test("正常なサイズはエラーなし", () => {
    expect(validateFileSize(1024)).toHaveLength(0);
  });

  test("0 は warning（空ファイル）", () => {
    const result = warningsOnly(validateFileSize(0));
    expect(result).toHaveLength(1);
  });

  test("負の値は error", () => {
    const result = errorsOnly(validateFileSize(-100));
    expect(result).toHaveLength(1);
  });

  test("5TB 超は error", () => {
    const result = errorsOnly(validateFileSize(MAX_S3_OBJECT_SIZE + 1));
    expect(result).toHaveLength(1);
  });

  test("NaN は error", () => {
    const result = errorsOnly(validateFileSize(NaN));
    expect(result).toHaveLength(1);
  });
});

// ── validateEnricherInput ────────────────────────────────────

describe("validateEnricherInput", () => {
  test("正常な入力はエラーなし", () => {
    const result = validateEnricherInput({ key: "data/file.csv", size: 1024 });
    expect(errorsOnly(result)).toHaveLength(0);
  });

  test("key 未定義は warning", () => {
    const result = warningsOnly(validateEnricherInput({ size: 100 }));
    expect(result.some((e) => e.field === "key")).toBe(true);
  });

  test("size 未定義は warning", () => {
    const result = warningsOnly(
      validateEnricherInput({ key: "file.csv" })
    );
    expect(result.some((e) => e.field === "size")).toBe(true);
  });

  test("size が文字列数値は正常変換", () => {
    const result = validateEnricherInput({ key: "file.csv", size: "500" });
    expect(errorsOnly(result)).toHaveLength(0);
  });

  test("size が非数値文字列は error", () => {
    const result = errorsOnly(
      validateEnricherInput({ key: "file.csv", size: "abc" })
    );
    expect(result.some((e) => e.field === "size")).toBe(true);
  });

  test("空オブジェクトは warning のみ", () => {
    const result = validateEnricherInput({});
    expect(errorsOnly(result)).toHaveLength(0);
    expect(warningsOnly(result).length).toBeGreaterThan(0);
  });

  test("不正な key は error", () => {
    const result = errorsOnly(
      validateEnricherInput({ key: "data/../secret", size: 100 })
    );
    expect(result.length).toBeGreaterThan(0);
  });
});

// ── isValidPriority ──────────────────────────────────────────

describe("isValidPriority", () => {
  test("high は有効", () => {
    expect(isValidPriority("high")).toBe(true);
  });

  test("normal は有効", () => {
    expect(isValidPriority("normal")).toBe(true);
  });

  test.each(["low", "HIGH", "critical", ""])(
    '"%s" は無効',
    (v) => {
      expect(isValidPriority(v)).toBe(false);
    }
  );
});

// ── validateEnricherOutput ───────────────────────────────────

describe("validateEnricherOutput", () => {
  test("正常な出力はエラーなし", () => {
    const output: EnricherOutput = {
      key: "data/file.csv",
      size: 1024,
      file_type: "csv",
      priority: "normal",
      enriched_at: "2026-09-01T09:00:00+09:00",
    };
    expect(validateEnricherOutput(output)).toHaveLength(0);
  });

  test("file_type が空は error", () => {
    const output: EnricherOutput = {
      file_type: "",
      priority: "normal",
      enriched_at: "2026-09-01T09:00:00+09:00",
    };
    const result = errorsOnly(validateEnricherOutput(output));
    expect(result.some((e) => e.field === "file_type")).toBe(true);
  });

  test("無効な priority は error", () => {
    const output = {
      file_type: "csv",
      priority: "low" as any,
      enriched_at: "2026-09-01T09:00:00+09:00",
    };
    const result = errorsOnly(validateEnricherOutput(output));
    expect(result.some((e) => e.field === "priority")).toBe(true);
  });

  test("enriched_at が空は error", () => {
    const output: EnricherOutput = {
      file_type: "csv",
      priority: "normal",
      enriched_at: "",
    };
    const result = errorsOnly(validateEnricherOutput(output));
    expect(result.some((e) => e.field === "enriched_at")).toBe(true);
  });
});

// ── validateInputOutputConsistency ───────────────────────────

describe("validateInputOutputConsistency", () => {
  test("入出力一致はエラーなし", () => {
    const input = { key: "data/file.csv", size: 1024 };
    const output: EnricherOutput = {
      key: "data/file.csv",
      size: 1024,
      file_type: "csv",
      priority: "normal",
      enriched_at: "2026-09-01T09:00:00+09:00",
    };
    expect(validateInputOutputConsistency(input, output)).toHaveLength(0);
  });

  test("key 不一致は error", () => {
    const input = { key: "data/file.csv", size: 1024 };
    const output: EnricherOutput = {
      key: "data/other.csv",
      size: 1024,
      file_type: "csv",
      priority: "normal",
      enriched_at: "2026-09-01T09:00:00+09:00",
    };
    const result = errorsOnly(validateInputOutputConsistency(input, output));
    expect(result.some((e) => e.field === "key")).toBe(true);
  });

  test("size 不一致は error", () => {
    const input = { key: "data/file.csv", size: 1024 };
    const output: EnricherOutput = {
      key: "data/file.csv",
      size: 999,
      file_type: "csv",
      priority: "normal",
      enriched_at: "2026-09-01T09:00:00+09:00",
    };
    const result = errorsOnly(validateInputOutputConsistency(input, output));
    expect(result.some((e) => e.field === "size")).toBe(true);
  });

  test("入力に key 未定義なら key チェックスキップ", () => {
    const input = { size: 1024 };
    const output: EnricherOutput = {
      key: "anything",
      size: 1024,
      file_type: "csv",
      priority: "normal",
      enriched_at: "2026-09-01T09:00:00+09:00",
    };
    expect(validateInputOutputConsistency(input, output)).toHaveLength(0);
  });
});

// ── hasErrors / formatErrors ─────────────────────────────────

describe("hasErrors", () => {
  test("error ありは true", () => {
    expect(
      hasErrors([{ field: "x", message: "e", severity: "error" }])
    ).toBe(true);
  });

  test("warning のみは false", () => {
    expect(
      hasErrors([{ field: "x", message: "w", severity: "warning" }])
    ).toBe(false);
  });

  test("空配列は false", () => {
    expect(hasErrors([])).toBe(false);
  });
});

describe("formatErrors", () => {
  test("空配列は通過メッセージ", () => {
    expect(formatErrors([])).toBe("すべてのチェックが通過しました");
  });

  test("error フォーマット", () => {
    const errors: ValidationError[] = [
      { field: "key", message: "テスト", severity: "error" },
    ];
    expect(formatErrors(errors)).toBe("[ERROR] key: テスト");
  });

  test("複数件は改行区切り", () => {
    const errors: ValidationError[] = [
      { field: "a", message: "e1", severity: "error" },
      { field: "b", message: "w1", severity: "warning" },
    ];
    expect(formatErrors(errors).split("\n")).toHaveLength(2);
  });
});
